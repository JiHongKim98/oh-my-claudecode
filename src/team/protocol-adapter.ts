// src/team/protocol-adapter.ts

/**
 * OMC Protocol Adapter — Phase 3a
 *
 * Maps between OMC's internal team types and cli-agent-mail protocol types.
 * This is additive only — no existing OMC types or code paths are changed.
 *
 * Phase 3a: Types + conversion functions only. No behavior changes.
 */

import { join } from 'path';
import type {
  ProtocolTask,
  ProtocolMessage,
  ProtocolHeartbeat,
  ProtocolWorkerInfo,
} from 'cli-agent-mail';

import type {
  TaskFile,
  InboxMessage,
  OutboxMessage,
  HeartbeatData,
  McpWorkerMember,
} from './types.js';

// ─── TaskFile ↔ ProtocolTask ──────────────────────────────────────────────────

/**
 * Convert an OMC TaskFile to a cli-agent-mail ProtocolTask.
 *
 * Field mapping:
 *   TaskFile.blockedBy   → ProtocolTask.depends_on
 *   TaskFile.status      → ProtocolTask.status  (values are compatible subset)
 *   TaskFile.blocks      → stored in metadata.blocks (no direct protocol field)
 */
export function toProtocolTask(task: TaskFile): ProtocolTask {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id: task.id,
    subject: task.subject,
    description: task.description,
    status: task.status as ProtocolTask['status'],
    owner: task.owner || undefined,
    depends_on: task.blockedBy.length > 0 ? task.blockedBy : undefined,
    version: 1,
    metadata: {
      ...(task.metadata ?? {}),
      blocks: task.blocks,
      activeForm: task.activeForm,
      claimedBy: task.claimedBy,
      claimedAt: task.claimedAt,
      claimPid: task.claimPid,
    },
    created_at: now,
  };
}

/**
 * Convert a cli-agent-mail ProtocolTask back to an OMC TaskFile.
 *
 * Field mapping:
 *   ProtocolTask.depends_on  → TaskFile.blockedBy
 *   metadata.blocks          → TaskFile.blocks
 */
export function fromProtocolTask(task: ProtocolTask): TaskFile {
  const meta = task.metadata ?? {};
  return {
    id: task.id,
    subject: task.subject,
    description: task.description,
    activeForm: (meta['activeForm'] as string | undefined) ?? undefined,
    status: task.status as TaskFile['status'],
    owner: task.owner ?? '',
    blocks: Array.isArray(meta['blocks']) ? (meta['blocks'] as string[]) : [],
    blockedBy: task.depends_on ?? [],
    metadata: Object.fromEntries(
      Object.entries(meta).filter(
        ([k]) => !['blocks', 'activeForm', 'claimedBy', 'claimedAt', 'claimPid'].includes(k),
      ),
    ),
    claimedBy: meta['claimedBy'] as string | undefined,
    claimedAt: meta['claimedAt'] as number | undefined,
    claimPid: meta['claimPid'] as number | undefined,
  };
}

// ─── OutboxMessage → ProtocolMessage ─────────────────────────────────────────

/**
 * Convert an OMC OutboxMessage (worker → lead, JSONL) to a ProtocolMessage.
 *
 * OMC outbox messages are structurally simpler than protocol messages.
 * The `workerName` is required because OMC JSONL messages don't carry the sender.
 */
export function toProtocolMessage(
  msg: OutboxMessage,
  workerName: string,
): ProtocolMessage {
  // Map OMC message types to protocol message types
  let protocolType: ProtocolMessage['type'];
  switch (msg.type) {
    case 'ready':
    case 'idle':
    case 'heartbeat':
    case 'shutdown_ack':
    case 'drain_ack':
      protocolType = 'status';
      break;
    case 'task_complete':
    case 'task_failed':
      protocolType = 'result';
      break;
    case 'error':
      protocolType = 'status';
      break;
    default:
      protocolType = 'chat';
  }

  const body = JSON.stringify({
    type: msg.type,
    taskId: msg.taskId,
    summary: msg.summary,
    message: msg.message,
    error: msg.error,
    requestId: msg.requestId,
  });

  return {
    message_id: `${workerName}-${msg.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    from: workerName,
    to: 'lead',
    type: protocolType,
    body,
    created_at: msg.timestamp,
  };
}

/**
 * Convert a ProtocolMessage (lead → worker) back to an OMC InboxMessage.
 *
 * Protocol messages have richer structure; OMC InboxMessage is simpler.
 */
export function fromProtocolMessage(msg: ProtocolMessage): InboxMessage {
  return {
    type: msg.type === 'instruction' ? 'message' : 'context',
    content: msg.body,
    timestamp: msg.created_at,
  };
}

// ─── HeartbeatData ↔ ProtocolHeartbeat ───────────────────────────────────────

/**
 * Convert an OMC HeartbeatData to a ProtocolHeartbeat.
 *
 * OMC heartbeats include provider/team/consecutive-error data that have
 * no direct protocol field — they are preserved in metadata.
 * Note: ProtocolHeartbeat does not include 'quarantined' status.
 */
export function toProtocolHeartbeat(hb: HeartbeatData): ProtocolHeartbeat {
  // 'quarantined' is OMC-only; map to 'shutdown' for protocol compatibility
  const protocolStatus: ProtocolHeartbeat['status'] =
    hb.status === 'quarantined' ? 'shutdown' : hb.status;

  return {
    pid: hb.pid,
    last_active_at: hb.lastPollAt,
    status: protocolStatus,
    current_task_id: hb.currentTaskId,
    metadata: {
      workerName: hb.workerName,
      teamName: hb.teamName,
      provider: hb.provider,
      consecutiveErrors: hb.consecutiveErrors,
      omcStatus: hb.status,
    },
  };
}

/**
 * Convert a ProtocolHeartbeat back to an OMC HeartbeatData.
 *
 * `workerName` and `teamName` are required because they are not in the
 * protocol heartbeat (they are inferred from path/context in OMC).
 */
export function fromProtocolHeartbeat(
  hb: ProtocolHeartbeat,
  workerName: string,
  teamName: string,
): HeartbeatData {
  const meta = hb.metadata ?? {};

  // Prefer the original OMC status preserved in metadata
  const omcStatus = (meta['omcStatus'] as HeartbeatData['status'] | undefined) ?? hb.status;

  return {
    workerName: (meta['workerName'] as string | undefined) ?? workerName,
    teamName: (meta['teamName'] as string | undefined) ?? teamName,
    provider: (meta['provider'] as HeartbeatData['provider'] | undefined) ?? 'codex',
    pid: hb.pid,
    lastPollAt: hb.last_active_at,
    currentTaskId: hb.current_task_id,
    consecutiveErrors: (meta['consecutiveErrors'] as number | undefined) ?? 0,
    status: omcStatus as HeartbeatData['status'],
  };
}

// ─── McpWorkerMember → ProtocolWorkerInfo ────────────────────────────────────

/**
 * Convert an OMC McpWorkerMember to a ProtocolWorkerInfo.
 *
 * McpWorkerMember is richer (cwd, subscriptions, etc.); the protocol
 * only captures name/index/role/assigned_tasks/pid/pane_id.
 */
export function toProtocolWorkerInfo(member: McpWorkerMember): ProtocolWorkerInfo {
  return {
    name: member.name,
    index: 0,          // index is not stored in McpWorkerMember; caller may override
    role: member.agentType,
    assigned_tasks: [],
    pane_id: member.tmuxPaneId,
  };
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve the OMC state root for a given working directory.
 * Returns `{cwd}/.omc/state`.
 */
export function resolveStateRoot(cwd: string): string {
  return join(cwd, '.omc', 'state');
}
