# SDLC Orchestrator — Discovery Spike (Task 0)

Live AO integration APIs, confirmed against this worktree's `@contaazul/cahi-core`
(the actual compile target — not `/tmp/ao-ref`, though they match). This locks the
seams Track E builds on so integration code doesn't drift.

## Package specifier substitutions (placeholder → real)

The plan uses `@ao/*` placeholders. The real specifiers in this monorepo are:

| Plan placeholder | Real specifier |
|---|---|
| `@ao/sdlc` | `@contaazul/cahi-sdlc` |
| `@ao/core` | `@contaazul/cahi-core` |
| `@ao/cli`  | `@contaazul/cahi-cli` |
| `@ao/web`  | `@contaazul/cahi-web` |

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
    `createSessionManager({ config, registry })` from `@contaazul/cahi-core`.
  - Config: `loadConfig()` from `@contaazul/cahi-core` returns `OrchestratorConfig`/`LoadedConfig`.
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
  - `getAoBaseDir()` → `~/.cahi` (storage root).
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
the `@contaazul/cahi-sdlc` barrel** (cleaner, no exports map, consistent). The barrel
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
`@contaazul/cahi-sdlc` (pure TS + `js-yaml` + `node:fs`, zero sqlite dependency) and to the
3 optional `SessionMetadata` fields (type-only, tested without sqlite). The
"never build on a broken base" gate is about broken CODE, not a sandbox native-binding gap.

**Per-task verification gate used by this build:**
`pnpm --filter @contaazul/cahi-sdlc test` (+ the targeted core test for the 3 metadata
fields). At wrap-up, `pnpm -r test` is EXPECTED to show exactly those 6 sqlite failures;
any NEW failure, or ANY failure outside that one file, is a regression.

---

## Task 20 — real gate wiring (live-smoke seam)

V1 shipped the gate path stubbed (bare `{artifact}` template + synthetic `plan:`/`epic:`
artifact refs). Task 20 wires it for real so a run can complete end-to-end.

### pattern-library availability (this host)

`claude` 2.1.161 is on PATH and the ContaAzul pattern-library plugin is installed
user-level at `~/.claude/plugins/cache/ca-pattern-library` (with the `gerar-backend`
skill). So headless `claude -p` sessions spawned by AO on this host inherit
pattern-library.

### gerar-backend ContaAzul-workspace prerequisite

The `/gerar-backend` skill's own prereq check requires a ContaAzul-shaped workspace
(sibling `{servico}/` + `{servico}-infra/` + the CodeRabbit CLI). On a generic /
throwaway repo that gate trips and the session halts early without producing output.
This is why the smoke does **not** use `/gerar-backend`: see the injectable instruction
below.

### Injectable per-task generation instruction

`makeGenerateBackendExecutor`'s `GenerateBackendDeps.buildTaskPrompt?` overrides the
per-task prompt; it **defaults** to the canonical `/gerar-backend` wording (so the
canonical `ca-plan-to-backend` workflow + its tests are unchanged). The CLI exposes it
as `cahi sdlc start --generation-instruction <text>` (and the same flag on `cahi sdlc
approve`, since approve resumes into generate-backend — pass the same value to both).
The Node-CRUD smoke passes a generic instruction like *"Implement this task as plain
Node.js. Write the code files…"* — no ContaAzul skill, no prereq gate.

### Readable artifact paths

- `normalize-plan` writes the normalized plan markdown to
  `${os.tmpdir()}/ao-sdlc-${runId}-plan.md` and returns that absolute path as
  `artifactRef`, so the lens agent can `Read` it.
- `generate-backend` returns the spawned task worktree path(s) (one per line) as
  `artifactRef` (`Session.workspacePath`, surfaced through `SpawnFn`), falling back to
  `epic:${id}` when no path is available (e.g. injected-fake unit tests).

### Lenient smoke-eval (`smokeEvalArtifact`) + how to swap in the real eval

`smokeEvalArtifact(artifactRef)` is an `EvalCommandRunner` exported from
`@contaazul/cahi-sdlc`. It splits `artifactRef` on newlines and passes **only** if at least
one path contains generated files (recursive; ignoring `.git`/`node_modules`/`.cahi`);
otherwise it returns `{passed:false}` **with a finding**. It is NOT a silent pass.
Both factories (`buildSdlcServices` in cli, `buildWebSdlcEngine` in web) inject it as
`runEvalCommand`. To use the real ContaAzul eval on a `ca-*` repo, swap the injected
`runEvalCommand` for an invocation of `/avaliar-artefato` (the eval-runner) — the
`Gate`/`EvalCommandRunner` seam is unchanged.

### Prereq-fail-is-graceful

If a generation session halts early (e.g. the gerar-backend prereq gate) and produces
no output: `waitForDone` still returns a terminal outcome (bounded by a 2h poll cap),
the task is marked done/blocked, then `smokeEvalArtifact` finds an empty worktree →
`needs_fixes` → the engine marks the run **failed cleanly** (no hang, no stuck-running).
The gate loop is wrapped in try/catch, so even a throwing eval fails the run rather than
leaving it `running`. This guarantees the skeleton-only smoke completes even when the
generator can't run on a non-ContaAzul repo.

### Lens prompt bodies at runtime

`loadLensPrompt(name)` reads `gates/prompts/<name>.md` relative to its compiled module
(`import.meta.url`) — `src/gates/prompts` under vitest, `dist/gates/prompts` at runtime
(the build copies them via `cpSync`). The web keeps `@contaazul/cahi-sdlc` in
`next.config.js` `serverExternalPackages` so Next does not bundle it (bundling would
rewrite `import.meta.url` and break the prompt path).

### Smoke target — repo-agnostic

The orchestrator wiring hardcodes no target. `cahi sdlc start --project <id>` parameterizes
the spawn target; at live-smoke time the target is a FRESH THROWAWAY dir so the generated
Node CRUD lands there, not in agent-orchestrator. `examples/sample-plan.md` is the 2-task
Node Users CRUD plan (`User store` → `HTTP CRUD API`).
