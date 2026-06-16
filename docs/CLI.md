# CAHI CLI Reference

The `cahi` CLI is the control interface for CAHI. Most commands are used by the **orchestrator agent itself** to manage sessions, not by humans directly. Humans typically only need `cahi start` and the web dashboard.

## Commands humans use

```bash
cahi start                               # Auto-detect, generate config, start dashboard + orchestrator
cahi start <url>                         # Clone repo, auto-configure, and start
cahi start ~/other-repo                  # Add a new project and start
cahi stop                                # Stop everything (dashboard, orchestrator, lifecycle worker)
cahi status                              # Overview of all sessions
cahi status --watch                      # Live-updating terminal status view
cahi dashboard                           # Open web dashboard in browser
cahi setup dashboard                     # Configure dashboard notification retention/routing
cahi setup desktop                       # Install/configure native macOS desktop notifications
cahi notify test --to desktop            # Send a manual notifier test without starting CAHI
cahi completion zsh                      # Print the zsh completion script
```

## Commands the orchestrator agent uses

These are primarily invoked by the orchestrator agent running inside a runtime session (a tmux window on macOS/Linux; a ConPTY pty-host on Windows). You can use them manually if needed, but the orchestrator handles this automatically.

```bash
cahi spawn [issue]                       # Spawn an agent (project auto-detected from cwd)
cahi spawn 123 --agent codex             # Override agent for this session
cahi batch-spawn 101 102 103             # Spawn agents for multiple issues at once
cahi send <session> "Fix the tests"      # Send instructions to a running agent
cahi session ls                          # List active sessions (terminated hidden)
cahi session ls --include-terminated     # Include killed/done/merged/errored/cleanup sessions
cahi session ls --json                   # Machine-readable session inventory (see note below)
cahi session kill <session>              # Kill a session
cahi session restore <session>           # Revive a crashed agent
```

> **JSON output:** `cahi session ls --json` and `cahi status --json` emit
> `{ "data": [...], "meta": { "hiddenTerminatedCount": N } }`. Terminated sessions
> (`killed`, `terminated`, `done`, `merged`, `errored`, `cleanup`) are filtered from
> `data` by default; `meta.hiddenTerminatedCount` reports how many were dropped.
> Pass `--include-terminated` to include them and reset the count to `0`.

## Maintenance commands

```bash
cahi doctor                              # Check install, runtime, and stale temp issues
cahi doctor --fix                        # Apply safe fixes automatically
cahi setup openclaw                      # Connect CAHI notifications to OpenClaw
cahi update                              # Update local CAHI install (source installs only)
cahi config-help                         # Show full config schema reference
```

## Zsh completion

```bash
mkdir -p ~/.zsh/completions
cahi completion zsh > ~/.zsh/completions/_cahi
```

Add the directory to `fpath` before running `compinit`:

```zsh
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit
compinit
```

With Oh My Zsh, write the generated file to `${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/cahi/_ao`
and add `cahi` to the `plugins=(...)` list in `~/.zshrc`.

`cahi doctor` checks PATH and launcher resolution, required binaries, configured plugin resolution, terminal-runtime health (tmux on Unix; PowerShell / `runtime-process` on Windows), GitHub CLI health, config support directories, stale CAHI temp files, and core build/runtime sanity. Runs and is supported on macOS, Linux, and Windows.

`cahi update` fast-forwards the local install on `main`, reinstalls dependencies, clean-rebuilds core packages, refreshes the launcher, and runs smoke tests. Works on macOS, Linux, and Windows (Windows uses the bundled `ao-update.ps1` script automatically). Use `cahi update --skip-smoke` to stop after rebuild, or `cahi update --smoke-only` to rerun just the smoke checks.

## Multi-Project Rollout

Portfolio mode is enabled by default. Users do not need to set `CAHI_ENABLE_PORTFOLIO` unless they explicitly want to disable portfolio/project-management flows.
