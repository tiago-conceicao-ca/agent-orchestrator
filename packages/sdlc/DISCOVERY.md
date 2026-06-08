# SDLC Orchestrator — Discovery Spike (Task 0)

Live AO integration APIs, confirmed against this worktree's `@aoagents/ao-core`
(the actual compile target — not `/tmp/ao-ref`, though they match). This locks the
seams Track E builds on so integration code doesn't drift.

## Package specifier substitutions (placeholder → real)

The plan uses `@ao/*` placeholders. The real specifiers in this monorepo are:

| Plan placeholder | Real specifier |
|---|---|
| `@ao/sdlc` | `@aoagents/ao-sdlc` |
| `@ao/core` | `@aoagents/ao-core` |
| `@ao/cli`  | `@aoagents/ao-cli` |
| `@ao/web`  | `@aoagents/ao-web` |

Used everywhere below and in all package.json / imports / test filters.

## Step 1 — SessionManager construction + spawn signature

- `SessionSpawnConfig` (`packages/core/src/types.ts:372`):
  ```ts
  interface SessionSpawnConfig {
    projectId: string;
    issueId?: string;
    branch?: string;
    prompt?: string;       // free-form, OPTIONAL
    agent?: string;
    subagent?: string;
  }
  ```
- `SessionManager.spawn(config: SessionSpawnConfig): Promise<Session>` (`types.ts:1875`).
- **DECISION GATE (Task 0): PASSED.** `spawn()` accepts a free-form `prompt` and does
  NOT require a tracker `issueId`. → No fallback local-tracker plugin needed. Task 13
  proceeds as written: spawn one session per task with a `/gerar-backend` prompt.
- Obtaining a SessionManager:
  - CLI: `getSessionManager(config)` → `Promise<OpenCodeSessionManager>` from
    `packages/cli/src/lib/create-session-manager.ts`, which calls
    `createSessionManager({ config, registry })` from `@aoagents/ao-core`.
  - Config: `loadConfig()` from `@aoagents/ao-core` returns `OrchestratorConfig`/`LoadedConfig`.
- `Session` (`types.ts:280`) carries `id`, `projectId`, `status: SessionStatus`,
  `activity`, `lifecycle`.
- Terminal status mapping for `waitForDone` (`types.ts:228`):
  `TERMINAL_STATUSES = { killed, terminated, done, cleanup, errored, merged }`.
  - → `merged | done | cleanup` map to `"done"`.
  - → `killed | terminated | errored` map to `"failed"`.
  - `isTerminalSession(session)` also inspects `lifecycle` (pr.state === "merged",
    runtime.state === "missing"/"exited", session.state === "done"/"terminated").

## Step 2 — Metadata write API + on-disk path

- `updateMetadata(dataDir: string, sessionId: SessionId, updates: Partial<Record<string,string>>): void`
  (`packages/core/src/metadata.ts:331`). Also `readMetadata`, `writeMetadata`,
  `listMetadata`, `deleteMetadata`. Metadata values are STRINGS — the SDLC fields
  (`sdlcRunId`/`sdlcTaskId`/`sdlcPhase`) fit naturally.
- Paths (`packages/core/src/paths.ts`):
  - `getAoBaseDir()` → `~/.agent-orchestrator` (storage root).
  - `getProjectDir(projectId)` → `{aoBaseDir}/projects/{projectId}`.
  - `getProjectSessionsDir(projectId)` → `{projectDir}/sessions` (this is the `dataDir`
    passed to `updateMetadata`).
- **SDLC run-store layout:** `new RunStore(getProjectDir(projectId))` writes runs to
  `{projectDir}/sdlc/runs/{runId}.json` (a sibling of `sessions/`), matching the plan's
  `.../sdlc/` intent.

## Step 3 — Dashboard / web service-access path

- Web API routes get services via `import { getServices } from "@/lib/services"`:
  ```ts
  const { config, registry, sessionManager, lifecycleManager } = await getServices();
  ```
  `getServices(): Promise<Services>`, `Services = { config: LoadedConfig; registry;
  sessionManager: OpenCodeSessionManager; lifecycleManager }`.
- `config.projects` is `Record<projectId, ProjectConfig>`.
- Dynamic routes use `export const dynamic = "force-dynamic"`.
- `/api/sdlc/runs` mirrors this: `getServices()` → for each project,
  `new RunStore(getProjectDir(projectId)).list()`.

## Step 4 — Monorepo tooling

- pnpm `9.15.4`, Node `22.16.0`.
- Workspace globs (`pnpm-workspace.yaml`): `packages/*`, `packages/plugins/*`.
  → `packages/sdlc` is auto-detected, no glob change needed.
- Cross-package deps use `workspace:*`.
- Test runner: Vitest. Per-package `test` script = `vitest run`.
- CLI commands are registered via `register<Name>(program: Command)` functions wired in
  `packages/cli/src/program.ts`. The SDLC command follows this: export `registerSdlc(program)`
  and add it to `createProgram()`.

## Deep subpath imports (Tasks 16/17/18) — decision

The plan imports e.g. `@ao/sdlc/workflow/engine`. The sdlc `package.json` has
`main: ./dist/index.js` and no `exports` subpath map. **Decision: import everything from
the `@aoagents/ao-sdlc` barrel** (cleaner, no exports map, consistent). The barrel
(`src/index.ts`) re-exports all symbols CLI/web need: `WorkflowEngine`, `RunStore`,
workflow types (`WorkflowRun`, `WorkflowDefinition`, …), `CA_PLAN_TO_BACKEND`, the phase
executor factories, the gate factories, and plan types. Test files that the plan wrote
with deep subpaths are adjusted to barrel imports to keep the build green.

## Base verification — KNOWN ENVIRONMENT ARTIFACT (not a regression)

`pnpm -r build` is **fully green** across all 32 packages → base code is healthy.

`pnpm -r test` shows **exactly 6 failures, all in
`packages/core/src/__tests__/events-fts-integration.test.ts`** (1338/1344 core tests pass).
Root cause:
- `events-fts-integration.test.ts` hard-requires a real `better-sqlite3`
  (`require` + `:memory:` + FTS5).
- `better-sqlite3@^12.10.0` is a core dependency, but its **native binding
  (`better_sqlite3.node`) is absent** in `node_modules/.pnpm/...`.
- Cause: pnpm 9 `onlyBuiltDependencies` allowlist skips the `better-sqlite3` build
  script, and `prebuild-install` is blocked by a corporate proxy cert
  (`/tmp/netskope-contaazul-ca.pem`), so no prebuilt binary is fetched either.

This is a **pre-existing sandbox/environment artifact**, fully orthogonal to
`@aoagents/ao-sdlc` (pure TS + `js-yaml` + `node:fs`, zero sqlite dependency) and to the
3 optional `SessionMetadata` fields (type-only, tested without sqlite). The
"never build on a broken base" gate is about broken CODE, not a sandbox native-binding gap.

**Per-task verification gate used by this build:**
`pnpm --filter @aoagents/ao-sdlc test` (+ the targeted core test for the 3 metadata
fields). At wrap-up, `pnpm -r test` is EXPECTED to show exactly those 6 sqlite failures;
any NEW failure, or ANY failure outside that one file, is a regression.
