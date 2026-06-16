<div align="center">

# CAHI (`cahi`)

**The orchestration layer for parallel AI coding agents.**

[![npm version](https://img.shields.io/npm/v/%40contaazul%2Fcahi?style=flat-square)](https://www.npmjs.com/package/@contaazul/cahi)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](https://github.com/contaazul/cahi/blob/main/LICENSE)

</div>

Spawn parallel AI coding agents, each in its own git worktree, on a single machine. Agents autonomously fix CI failures, address review comments, and open PRs — you supervise the whole fleet from one dashboard.

**Agent-agnostic** (Claude Code, Codex, Aider, Cursor, OpenCode) · **Runtime-agnostic** (tmux, ConPTY/process, Docker) · **Tracker-agnostic** (GitHub, Linear, GitLab)

## Install

```bash
npm install -g @contaazul/cahi
```

> **Nightly builds** (latest `main`): `npm install -g @contaazul/cahi@nightly` — back to stable with `@latest`.

**Prerequisites:** [Node.js 20.18.3+](https://nodejs.org), [Git 2.25+](https://git-scm.com), the [`gh` CLI](https://cli.github.com), and at least one coding-agent CLI (e.g. [Claude Code](https://www.anthropic.com/claude-code)).

- **macOS / Linux:** [tmux](https://github.com/tmux/tmux/wiki/Installing) — `brew install tmux` or `sudo apt install tmux`.
- **Windows:** PowerShell 7+ recommended; tmux is **not** required (CAHI uses native ConPTY via the `process` runtime).

## Quick start

Point it at any repo — it clones, configures, and launches the dashboard in one command:

```bash
cahi start https://github.com/your-org/your-repo
```

Or from inside an existing local repo:

```bash
cd ~/your-project && cahi start
```

The dashboard opens at `http://localhost:4000` and an orchestrator agent starts managing your project. Add more repos any time:

```bash
cahi start ~/path/to/another-repo
```

You don't need to learn the CLI — the dashboard and the orchestrator agent drive everything. (Individual `cahi` commands are documented in the [CLI Reference](https://github.com/contaazul/cahi/blob/main/docs/CLI.md) and used internally by the orchestrator.)

## How it works

1. **You start** — `cahi start` launches the dashboard and an orchestrator agent.
2. **Orchestrator spawns workers** — each issue gets its own agent in an isolated git worktree and branch.
3. **Agents work autonomously** — they read code, write tests, and open PRs.
4. **Reactions handle feedback** — CI failures and review comments are routed back to the responsible agent automatically.
5. **You review and merge** — you're pulled in only when human judgment is needed.

## Pluggable by design

Seven plugin slots; the lifecycle state machine stays in core:

| Slot | Default | Alternatives |
| --- | --- | --- |
| Runtime | tmux (macOS/Linux) / process (Windows) | process, docker |
| Agent | claude-code | codex, aider, cursor, opencode, kimicode |
| Workspace | worktree | clone |
| Tracker | github | linear, gitlab |
| SCM | github | gitlab |
| Notifier | desktop | slack, discord, composio, webhook, openclaw |
| Terminal | iterm2 | web |

## Why CAHI?

Running one AI agent in a terminal is easy. Running 30 across different issues, branches, and PRs is a coordination problem: creating branches, detecting stuck agents, reading CI failures, forwarding review comments, tracking which PRs are ready, and cleaning up afterward.

CAHI handles the isolation, feedback routing, and status tracking. You `cahi start` and walk away — then review PRs and make decisions. The rest is automated.

## Documentation

- 📖 [Project README & overview](https://github.com/contaazul/cahi)
- 🛠️ [Setup guide](https://github.com/contaazul/cahi/blob/main/SETUP.md) — install, configuration, troubleshooting
- ⌨️ [CLI reference](https://github.com/contaazul/cahi/blob/main/docs/CLI.md)
- 🧩 [Development & plugin guide](https://github.com/contaazul/cahi/blob/main/docs/DEVELOPMENT.md)

## License

MIT © [Conta Azul](https://github.com/contaazul/cahi)
