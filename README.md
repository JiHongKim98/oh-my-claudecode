<div align="center">

![oh-my-claudecode](https://raw.githubusercontent.com/Yeachan-Heo/oh-my-claudecode-website/main/social-preview.png)

# oh-my-claudecode

[![Version](https://img.shields.io/badge/version-3.0.0-6366f1)](https://github.com/Yeachan-Heo/oh-my-claudecode)
[![npm version](https://img.shields.io/npm/v/oh-my-claude-sisyphus?color=cb3837)](https://www.npmjs.com/package/oh-my-claude-sisyphus)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Multi-agent orchestration for Claude Code. Zero learning curve.**

*Some advanced users customize zsh for years — most of us just use oh-my-zsh.*
*Don't learn Claude Code. Just use OMC.*

[Get Started](#get-started) • [Documentation](https://yeachan-heo.github.io/oh-my-claudecode-website) • [Migration Guide](docs/MIGRATION.md)

</div>

---

## Get Started (30 seconds)

**Step 1:** Install the plugin
```
/plugin marketplace add Yeachan-Heo/oh-my-claudecode
```

**Step 2:** Run setup
```
/omc-setup
```

That's it. Everything else is automatic.

---

## What Happens Now

| When You... | I Automatically... |
|-------------|-------------------|
| Give me a complex task | Parallelize with specialist agents |
| Say "plan this" | Start a planning interview |
| Say "don't stop until done" | Persist until verified complete |
| Work on UI/frontend | Activate design sensibility |
| Need research or exploration | Delegate to specialized agents |

**You don't need to learn any commands.** I detect what you need and activate the right behaviors.

---

## Magic Keywords (Power Users)

Want explicit control? Include these words anywhere in your message:

| Keyword | Effect |
|---------|--------|
| `ralph` | Persistence mode - won't stop until done |
| `ralplan` | Iterative planning with consensus |
| `ulw` | Maximum parallel execution |
| `plan` | Start a planning interview |

**Combine them:** `ralph ulw: migrate the database`

---

## Stopping Things

Just say:
- "stop"
- "cancel"
- "abort"

I'll intelligently determine what to stop based on context.

---

## What's Under the Hood

- **19 Specialized Agents** - architect, researcher, explore, designer, writer, vision, critic, analyst, executor, planner, qa-tester (with tier variants)
- **26 Skills** - orchestrate, ultrawork, ralph, planner, deepsearch, deepinit, git-master, frontend-ui-ux, learner, and more
- **HUD Statusline** - Real-time visualization of orchestration state
- **Learned Skills** - Extract reusable insights from sessions with `/learner`
- **Memory System** - Persistent context that survives compaction

---

## Coming from 2.x?

**Good news:** Your old commands still work!

```
/ralph "task"      →  Still works (or just say "ralph: task")
/ultrawork "task"  →  Still works (or just use "ulw" keyword)
/planner "task"    →  Still works (or just say "plan this")
```

The difference? You don't *need* them anymore. Everything auto-activates.

See the [Migration Guide](docs/MIGRATION.md) for details.

---

## Documentation

- [Full Reference](docs/FULL-README.md) - Complete documentation (800+ lines)
- [Migration Guide](docs/MIGRATION.md) - 2.x to 3.0 transition
- [Architecture](docs/ARCHITECTURE.md) - Technical deep-dive
- [Website](https://yeachan-heo.github.io/oh-my-claudecode-website) - Online docs

---

## Requirements

- [Claude Code](https://docs.anthropic.com/claude-code) CLI
- Anthropic API key

---

## License

MIT - see [LICENSE](LICENSE)

---

<div align="center">

Inspired by [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)

**Zero learning curve. Maximum power.**

</div>
