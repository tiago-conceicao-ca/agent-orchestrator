<h1 align="center">CAHI — Conta Azul Hub for Intelligence</h1>

<div align="center">

The orchestration layer for parallel AI agents at Conta Azul. Spawn parallel AI coding agents, each in its own git worktree. Agents autonomously fix CI failures, address review comments, and open PRs — you supervise from one dashboard.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

</div>

> **CAHI** (Conta Azul Hub for Intelligence) brings together **CAHI**, **Taskmaster**-style structured task planning, and **Conta Azul's AI-native initiative & principles** into a single platform for running fleets of AI coding agents. _Formerly CAHI._

---

CAHI manages fleets of AI coding agents working in parallel on your codebase. Each agent gets its own git worktree, its own branch, and its own PR. When CI fails, the agent fixes it. When reviewers leave comments, the agent addresses them. You only get pulled in when human judgment is needed.

**Agent-agnostic** (Claude Code, Codex, Aider) · **Runtime-agnostic** (tmux, ConPTY/process, Docker) · **Tracker-agnostic** (GitHub, Linear)

## Quick Start

> **Prerequisites:** [Node.js 20.18.3+](https://nodejs.org), [Git 2.25+](https://git-scm.com), [`gh` CLI](https://cli.github.com), and:
> - **macOS / Linux:** [tmux](https://github.com/tmux/tmux/wiki/Installing) — install via `brew install tmux` or `sudo apt install tmux`.
> - **Windows:** PowerShell 7+ recommended. tmux is **not** required — CAHI uses native ConPTY via the `runtime-process` plugin (the default on Windows). Set `CAHI_SHELL=bash` if you have Git Bash and prefer it.

### Install

```bash
npm install -g @contaazul/cahi
```

> **Nightly builds** (latest `main`, daily Fri–Tue): `npm install -g @contaazul/cahi@nightly`
> Back to stable: `npm install -g @contaazul/cahi@latest`

<details>
<summary>Permission denied? Install from source?</summary>

If `npm install -g` fails with EACCES, prefix with `sudo` or [fix your npm permissions](https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally).

To install from source (for contributors):

```bash
git clone https://github.com/contaazul/cahi.git
cd cahi && bash scripts/setup.sh
```
</details>

> **Upgrading from a previous CAHI (`cahi`) install?** Run [`scripts/migrate-cahi-to-cahi.sh`](scripts/migrate-cahi-to-cahi.sh) to move your legacy on-disk data into `~/.cahi` (and `~/.cahi/bin`, `~/.config/cahi`) and rewrite each registered project's config to `cahi.yaml`. Pass `--dry-run` first to preview every change.

### Zsh Completion

Generate the completion file from the installed CLI:

```bash
mkdir -p ~/.zsh/completions
cahi completion zsh > ~/.zsh/completions/_cahi
```

Then make sure the directory is on your `fpath` before `compinit` runs:

```zsh
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit
compinit
```

For Oh My Zsh, install the same generated file into a custom plugin directory and add `cahi` to your plugin list:

```bash
mkdir -p "${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/cahi"
cahi completion zsh > "${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/cahi/_cahi"
```

If you are contributing from a source checkout, you can also symlink the repo copy at [`completions/_cahi`](completions/_cahi).

### Start

Point it at any repo — it clones, configures, and launches the dashboard in one command:

```bash
cahi start https://github.com/your-org/your-repo
```

Or from inside an existing local repo:

```bash
cd ~/your-project && cahi start
```

That's it. The dashboard opens at `http://localhost:4000` and the orchestrator agent starts managing your project.

### Add more projects

```bash
cahi start ~/path/to/another-repo
```

## How It Works

1. **You start** — `cahi start` launches the dashboard and an orchestrator agent
2. **Orchestrator spawns workers** — each issue gets its own agent in an isolated git worktree
3. **Agents work autonomously** — they read code, write tests, create PRs
4. **Reactions handle feedback** — CI failures and review comments are automatically routed back to the agent
5. **You review and merge** — you only get pulled in when human judgment is needed

The orchestrator agent uses the [CAHI CLI](docs/CLI.md) internally to manage sessions. You don't need to learn or use the CLI — the dashboard and orchestrator handle everything.

## Configuration

`cahi start` auto-generates `cahi.yaml` with sensible defaults. You can edit it afterwards to customize behavior:

```yaml
# cahi.yaml
$schema: https://raw.githubusercontent.com/contaazul/cahi/main/schema/config.schema.json
# Runtime data is auto-derived under ~/.cahi/{hash}-{projectId}/
port: 4000

defaults:
  runtime: tmux       # default on macOS / Linux; on Windows the default is `process` (ConPTY)
  agent: claude-code
  workspace: worktree
  notifiers: [desktop]

projects:
  my-app:
    repo: owner/my-app
    path: ~/my-app
    defaultBranch: main
    sessionPrefix: app

reactions:
  ci-failed:
    auto: true
    action: send-to-agent
    retries: 2
  changes-requested:
    auto: true
    action: send-to-agent
    escalateAfter: 30m
  approved-and-green:
    auto: false # flip to true for auto-merge
    action: notify
```

CI fails → agent gets the logs and fixes it. Reviewer requests changes → agent addresses them. PR approved with green CI → you get a notification to merge.

Keep the `$schema` line so editors can autocomplete and validate against [`schema/config.schema.json`](schema/config.schema.json).

See [`cahi.yaml.example`](cahi.yaml.example) for the full reference, or run `cahi config-help` for the complete schema.

## Remote Access

CAHI keeps your Mac awake while running, so you can access the dashboard remotely (e.g., via Tailscale from your phone) without the machine going to sleep.

**How it works:** On macOS, CAHI automatically holds an idle-sleep prevention assertion using `caffeinate`. When CAHI exits, the assertion is released.

```yaml
# cahi.yaml
$schema: https://raw.githubusercontent.com/contaazul/cahi/main/schema/config.schema.json
power:
  preventIdleSleep: true  # Default on macOS; no-op on Linux and Windows
```

Set to `false` if you want to allow idle sleep while CAHI runs.

**Lid-close limitation:** macOS enforces lid-close sleep at the hardware level — no userspace assertion can override it. If you need remote access while traveling with the lid closed, use [clamshell mode](https://support.apple.com/en-us/102505) (external power + display + input device).

**Linux / Windows:** CAHI does not currently hold a wake assertion on these platforms. On Linux, idle-sleep behaviour is governed by your desktop environment / `systemd-logind`; configure that directly. On Windows, set the OS power plan if remote access matters while idle.

## Plugin Architecture

Seven plugin slots. Lifecycle stays in core.

| Slot      | Default     | Alternatives             |
| --------- | ----------- | ------------------------ |
| Runtime   | tmux (macOS/Linux) / process (Windows) | process, docker |
| Agent     | claude-code | codex, aider, cursor, opencode, kimicode |
| Workspace | worktree    | clone                    |
| Tracker   | github      | linear, gitlab           |
| SCM       | github      | gitlab                   |
| Notifier  | desktop     | slack, discord, composio, webhook, openclaw |
| Terminal  | iterm2      | web                      |

All interfaces defined in [`packages/core/src/types.ts`](packages/core/src/types.ts). A plugin implements one interface and exports a `PluginModule`. That's it.

## Why CAHI?

Running one AI agent in a terminal is easy. Running 30 across different issues, branches, and PRs is a coordination problem.

**Without orchestration**, you manually: create branches, start agents, check if they're stuck, read CI failures, forward review comments, track which PRs are ready to merge, clean up when done.

**With CAHI**, you: `cahi start` and walk away. The system handles isolation, feedback routing, and status tracking. You review PRs and make decisions — the rest is automated.

## Documentation

| Doc                                      | What it covers                                               |
| ---------------------------------------- | ------------------------------------------------------------ |
| [Setup Guide](SETUP.md)                  | Detailed installation, configuration, and troubleshooting    |
| [CLI Reference](docs/CLI.md)             | All `cahi` commands (mostly used by the orchestrator agent)  |
| [Examples](examples/)                    | Config templates (GitHub, Linear, multi-project, auto-merge) |
| [Development Guide](docs/DEVELOPMENT.md) | Architecture, conventions, plugin pattern                    |
| [Contributing](CONTRIBUTING.md)          | How to contribute, build plugins, PR process                 |

## Development

```bash
pnpm install && pnpm build    # Install and build all packages
pnpm test                      # Run tests
pnpm dev                       # Start web dashboard dev server
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for code conventions and architecture details.

## Contributing

Contributions welcome. The plugin system makes it straightforward to add support for new agents, runtimes, trackers, and notification channels. Every plugin is an implementation of a TypeScript interface — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Development Guide](docs/DEVELOPMENT.md) for the pattern.

## License

MIT
</content>
