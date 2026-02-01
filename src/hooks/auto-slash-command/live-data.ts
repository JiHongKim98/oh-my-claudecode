/**
 * Live Data Injection
 *
 * Resolves `!command` lines in skill/command templates by executing the command
 * and replacing the line with its output wrapped in <live-data> tags.
 *
 * Supports:
 * - Basic: `!git status`
 * - Caching: `!cache 300s git log -10`
 * - Conditional: `!if-modified src/** then git diff src/`
 * - Conditional: `!if-branch feat/* then echo "feature branch"`
 * - Once per session: `!only-once npm install`
 * - Output formats: `!json docker inspect ...`, `!table ...`, `!diff git diff`
 * - Multi-line: `!begin-script bash` ... `!end-script`
 * - Security allowlist via .omc/config/live-data-policy.json
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 50 * 1024; // 50KB

// ─── Types ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  output: string;
  error: boolean;
  cachedAt: number;
  ttl: number;
}

interface SecurityPolicy {
  allowed_commands?: string[];
  allowed_patterns?: string[];
  denied_commands?: string[];
  denied_patterns?: string[];
  require_approval?: string[];
}

type OutputFormat = 'json' | 'table' | 'diff' | null;

// ─── Cache ───────────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry>();
const onceCommands = new Set<string>();

/** Default TTL heuristics for common commands */
const DEFAULT_TTL: Record<string, number> = {
  'git status': 1,
  'git branch': 5,
  'git log': 60,
  'docker ps': 5,
  'node --version': 3600,
  'npm --version': 3600,
};

function getDefaultTtl(command: string): number {
  for (const [pattern, ttl] of Object.entries(DEFAULT_TTL)) {
    if (command.startsWith(pattern)) return ttl;
  }
  return 0; // no caching by default
}

function getCached(command: string): CacheEntry | null {
  const entry = cache.get(command);
  if (!entry) return null;
  if (entry.ttl > 0 && Date.now() - entry.cachedAt > entry.ttl * 1000) {
    cache.delete(command);
    return null;
  }
  return entry;
}

function setCache(command: string, output: string, error: boolean, ttl: number): void {
  if (ttl <= 0) return;
  cache.set(command, { output, error, cachedAt: Date.now(), ttl });
}

/** Clear all caches (useful for testing) */
export function clearCache(): void {
  cache.clear();
  onceCommands.clear();
}

// ─── Security ────────────────────────────────────────────────────────────────

let cachedPolicy: SecurityPolicy | null = null;
let policyLoadedFrom: string | null = null;

function loadSecurityPolicy(): SecurityPolicy {
  const policyPaths = [
    join(process.cwd(), '.omc', 'config', 'live-data-policy.json'),
    join(process.cwd(), '.claude', 'live-data-policy.json'),
  ];

  for (const p of policyPaths) {
    if (p === policyLoadedFrom && cachedPolicy) return cachedPolicy;
    if (existsSync(p)) {
      try {
        cachedPolicy = JSON.parse(readFileSync(p, 'utf-8')) as SecurityPolicy;
        policyLoadedFrom = p;
        return cachedPolicy;
      } catch {
        // ignore malformed policy
      }
    }
  }
  return {};
}

/** Reset cached policy (for testing) */
export function resetSecurityPolicy(): void {
  cachedPolicy = null;
  policyLoadedFrom = null;
}

function checkSecurity(command: string): { allowed: boolean; reason?: string } {
  const policy = loadSecurityPolicy();

  // Check denied patterns first
  if (policy.denied_patterns) {
    for (const pat of policy.denied_patterns) {
      try {
        if (new RegExp(pat).test(command)) {
          return { allowed: false, reason: `denied by pattern: ${pat}` };
        }
      } catch {
        // skip invalid regex
      }
    }
  }

  // Check denied commands
  if (policy.denied_commands) {
    const cmdBase = command.split(/\s/)[0];
    if (policy.denied_commands.includes(cmdBase)) {
      return { allowed: false, reason: `command '${cmdBase}' is denied` };
    }
  }

  // If an allowlist is defined, enforce it
  if (policy.allowed_commands && policy.allowed_commands.length > 0) {
    const cmdBase = command.split(/\s/)[0];
    const baseAllowed = policy.allowed_commands.includes(cmdBase);
    let patternAllowed = false;

    if (policy.allowed_patterns) {
      for (const pat of policy.allowed_patterns) {
        try {
          if (new RegExp(pat).test(command)) {
            patternAllowed = true;
            break;
          }
        } catch {
          // skip invalid regex
        }
      }
    }

    if (!baseAllowed && !patternAllowed) {
      return { allowed: false, reason: `command '${cmdBase}' not in allowlist` };
    }
  }

  return { allowed: true };
}

// ─── Line Classification ─────────────────────────────────────────────────────

/** Check if a line is a live-data command (starts with optional whitespace then `!`) */
export function isLiveDataLine(line: string): boolean {
  return /^\s*!(.+)/.test(line);
}

/** Extract ranges of fenced code blocks (0-indexed [start, end] pairs) */
function getCodeBlockRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let openIndex: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(`{3,}|~{3,})/.test(lines[i])) {
      if (openIndex === null) {
        openIndex = i;
      } else {
        ranges.push([openIndex, i]);
        openIndex = null;
      }
    }
  }
  return ranges;
}

function isInsideCodeBlock(lineIndex: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => lineIndex > start && lineIndex < end);
}

// ─── Command Parsing ─────────────────────────────────────────────────────────

interface ParsedDirective {
  type: 'basic' | 'cache' | 'if-modified' | 'if-branch' | 'only-once' | 'format';
  command: string;
  format?: OutputFormat;
  ttl?: number;
  pattern?: string;
}

function parseDirective(raw: string): ParsedDirective {
  const trimmed = raw.replace(/^\s*!/, '').trim();

  // !cache <seconds>s <command>
  const cacheMatch = trimmed.match(/^cache\s+(\d+)s?\s+(.+)$/);
  if (cacheMatch) {
    return { type: 'cache', ttl: parseInt(cacheMatch[1], 10), command: cacheMatch[2] };
  }

  // !if-modified <pattern> then <command>
  const ifModifiedMatch = trimmed.match(/^if-modified\s+(\S+)\s+then\s+(.+)$/);
  if (ifModifiedMatch) {
    return { type: 'if-modified', pattern: ifModifiedMatch[1], command: ifModifiedMatch[2] };
  }

  // !if-branch <pattern> then <command>
  const ifBranchMatch = trimmed.match(/^if-branch\s+(\S+)\s+then\s+(.+)$/);
  if (ifBranchMatch) {
    return { type: 'if-branch', pattern: ifBranchMatch[1], command: ifBranchMatch[2] };
  }

  // !only-once <command>
  const onlyOnceMatch = trimmed.match(/^only-once\s+(.+)$/);
  if (onlyOnceMatch) {
    return { type: 'only-once', command: onlyOnceMatch[1] };
  }

  // !json <command>, !table <command>, !diff <command>
  const formatMatch = trimmed.match(/^(json|table|diff)\s+(.+)$/);
  if (formatMatch) {
    return { type: 'format', format: formatMatch[1] as OutputFormat, command: formatMatch[2] };
  }

  return { type: 'basic', command: trimmed };
}

// ─── Conditional Helpers ─────────────────────────────────────────────────────

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '⟨GLOBSTAR⟩')
    .replace(/\*/g, '[^/]*')
    .replace(/⟨GLOBSTAR⟩/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function checkIfModified(pattern: string): boolean {
  try {
    const output = execSync('git diff --name-only 2>/dev/null || true', {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const regex = globToRegex(pattern);
    return output.split('\n').some((f) => regex.test(f.trim()));
  } catch {
    return false;
  }
}

function checkIfBranch(pattern: string): boolean {
  try {
    const branch = execSync('git branch --show-current 2>/dev/null || true', {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return globToRegex(pattern).test(branch);
  } catch {
    return false;
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function executeCommand(command: string): { stdout: string; error: boolean } {
  try {
    const stdout = execSync(command, {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES + 1024,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = stdout ?? '';
    let truncated = false;

    if (Buffer.byteLength(output, 'utf-8') > MAX_OUTPUT_BYTES) {
      const buf = Buffer.from(output, 'utf-8').subarray(0, MAX_OUTPUT_BYTES);
      output = buf.toString('utf-8');
      truncated = true;
    }

    if (truncated) {
      output += '\n... [output truncated at 50KB]';
    }

    return { stdout: output, error: false };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
    return { stdout: String(message), error: true };
  }
}

// ─── Output Formatting ──────────────────────────────────────────────────────

function formatOutput(
  command: string,
  output: string,
  error: boolean,
  format: OutputFormat
): string {
  const formatAttr = format ? ` format="${format}"` : '';
  const errorAttr = error ? ' error="true"' : '';

  if (format === 'diff' && !error) {
    // Extract diff stats
    const addLines = (output.match(/^\+[^+]/gm) || []).length;
    const delLines = (output.match(/^-[^-]/gm) || []).length;
    const files = new Set(
      (output.match(/^(?:diff --git|---|\+\+\+) [ab]\/(.+)/gm) || []).map((l) =>
        l.replace(/^(?:diff --git|---|\+\+\+) [ab]\//, '')
      )
    ).size;
    return `<live-data command="${command}"${formatAttr} files="${files}" +="${addLines}" -="${delLines}"${errorAttr}>${output}</live-data>`;
  }

  return `<live-data command="${command}"${formatAttr}${errorAttr}>${output}</live-data>`;
}

// ─── Multi-line Script Support ───────────────────────────────────────────────

interface ScriptBlock {
  startLine: number;
  endLine: number;
  shell: string;
  body: string;
}

function extractScriptBlocks(
  lines: string[],
  codeBlockRanges: Array<[number, number]>
): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  let current: { startLine: number; shell: string; bodyLines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (isInsideCodeBlock(i, codeBlockRanges)) continue;

    const beginMatch = lines[i].match(/^\s*!begin-script\s+(\S+)\s*$/);
    if (beginMatch && !current) {
      current = { startLine: i, shell: beginMatch[1], bodyLines: [] };
      continue;
    }

    if (/^\s*!end-script\s*$/.test(lines[i]) && current) {
      blocks.push({
        startLine: current.startLine,
        endLine: i,
        shell: current.shell,
        body: current.bodyLines.join('\n'),
      });
      current = null;
      continue;
    }

    if (current) {
      current.bodyLines.push(lines[i]);
    }
  }
  return blocks;
}

// ─── Main Resolver ───────────────────────────────────────────────────────────

/**
 * Resolve all live-data directives in content.
 * Lines inside fenced code blocks are skipped.
 */
export function resolveLiveData(content: string): string {
  const lines = content.split('\n');
  const codeBlockRanges = getCodeBlockRanges(lines);

  // First pass: extract and resolve multi-line script blocks
  const scriptBlocks = extractScriptBlocks(lines, codeBlockRanges);
  const scriptLineSet = new Set<number>();
  const scriptReplacements = new Map<number, string>();

  for (const block of scriptBlocks) {
    for (let i = block.startLine; i <= block.endLine; i++) {
      scriptLineSet.add(i);
    }

    const security = checkSecurity(block.shell);
    if (!security.allowed) {
      scriptReplacements.set(
        block.startLine,
        `<live-data command="script:${block.shell}" error="true">blocked: ${security.reason}</live-data>`
      );
      continue;
    }

    // Write script to stdin of shell
    try {
      const result = execSync(block.shell, {
        input: block.body,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES + 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      scriptReplacements.set(
        block.startLine,
        `<live-data command="script:${block.shell}">${result ?? ''}</live-data>`
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? (err as { stderr?: string }).stderr || err.message : String(err);
      scriptReplacements.set(
        block.startLine,
        `<live-data command="script:${block.shell}" error="true">${message}</live-data>`
      );
    }
  }

  // Second pass: process line by line
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Script block lines: emit replacement on start line, skip rest
    if (scriptLineSet.has(i)) {
      const replacement = scriptReplacements.get(i);
      if (replacement) result.push(replacement);
      continue;
    }

    const line = lines[i];
    if (!isLiveDataLine(line) || isInsideCodeBlock(i, codeBlockRanges)) {
      result.push(line);
      continue;
    }

    const directive = parseDirective(line);

    // Security check
    const security = checkSecurity(directive.command);
    if (!security.allowed) {
      result.push(
        `<live-data command="${directive.command}" error="true">blocked: ${security.reason}</live-data>`
      );
      continue;
    }

    switch (directive.type) {
      case 'if-modified': {
        if (!checkIfModified(directive.pattern!)) {
          result.push(
            `<live-data command="${directive.command}" skipped="true">condition not met: no files matching '${directive.pattern}' modified</live-data>`
          );
        } else {
          const { stdout, error } = executeCommand(directive.command);
          result.push(formatOutput(directive.command, stdout, error, null));
        }
        break;
      }

      case 'if-branch': {
        if (!checkIfBranch(directive.pattern!)) {
          result.push(
            `<live-data command="${directive.command}" skipped="true">condition not met: branch does not match '${directive.pattern}'</live-data>`
          );
        } else {
          const { stdout, error } = executeCommand(directive.command);
          result.push(formatOutput(directive.command, stdout, error, null));
        }
        break;
      }

      case 'only-once': {
        if (onceCommands.has(directive.command)) {
          result.push(
            `<live-data command="${directive.command}" skipped="true">already executed this session</live-data>`
          );
        } else {
          onceCommands.add(directive.command);
          const { stdout, error } = executeCommand(directive.command);
          result.push(formatOutput(directive.command, stdout, error, null));
        }
        break;
      }

      case 'cache': {
        const ttl = directive.ttl!;
        const cached = getCached(directive.command);
        if (cached) {
          result.push(
            formatOutput(directive.command, cached.output, cached.error, null).replace(
              '<live-data',
              '<live-data cached="true"'
            )
          );
        } else {
          const { stdout, error } = executeCommand(directive.command);
          setCache(directive.command, stdout, error, ttl);
          result.push(formatOutput(directive.command, stdout, error, null));
        }
        break;
      }

      case 'format': {
        const ttl = getDefaultTtl(directive.command);
        const cached = ttl > 0 ? getCached(directive.command) : null;
        if (cached) {
          result.push(
            formatOutput(directive.command, cached.output, cached.error, directive.format!).replace(
              '<live-data',
              '<live-data cached="true"'
            )
          );
        } else {
          const { stdout, error } = executeCommand(directive.command);
          if (ttl > 0) setCache(directive.command, stdout, error, ttl);
          result.push(formatOutput(directive.command, stdout, error, directive.format!));
        }
        break;
      }

      case 'basic':
      default: {
        const ttl = getDefaultTtl(directive.command);
        const cached = ttl > 0 ? getCached(directive.command) : null;
        if (cached) {
          result.push(
            formatOutput(directive.command, cached.output, cached.error, null).replace(
              '<live-data',
              '<live-data cached="true"'
            )
          );
        } else {
          const { stdout, error } = executeCommand(directive.command);
          if (ttl > 0) setCache(directive.command, stdout, error, ttl);
          result.push(formatOutput(directive.command, stdout, error, null));
        }
        break;
      }
    }
  }

  return result.join('\n');
}
