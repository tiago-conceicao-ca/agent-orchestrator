# SDLC implementation phase — taskmaster-modeled lens passes

This document maps taskmaster's implementation-phase design (studied in
`taskmaster-main`) onto CAHI's SDLC engine, records the invariants the
implementation preserves, and explains the two deliberate deviations.

## taskmaster → CAHI mapping

| taskmaster | CAHI |
|---|---|
| `workflow_config.yaml` `implement.passes` (initial/correctness/edge_cases/simplicity/excellence) + per-pass `template` + `model_family` | `packages/sdlc/src/passes/passes-config.ts` — `PASS_DEFS` (template id + model tier: initial=sonnet, reviews=opus) |
| `implement.complexity` gating (LOW/MEDIUM/HIGH → pass list) | `COMPLEXITY_PASSES` (LOW=3, MEDIUM=4, HIGH=5) + `passesForComplexity()` |
| `expander.py::_create_impl_tasks` — chain passes via `waits_for`, each review reads the previous pass | `packages/sdlc/src/passes/expand.ts::expandTaskPasses` — each logical task gets a `TaskPass[]`; review passes carry `previousPassId`/`initialPassId`; the initial pass `waitsFor` the upstream logical tasks' TERMINAL passes |
| per-pass prompt bodies | `packages/sdlc/src/gates/prompts/implement-lens-*.md` |
| `dispatch.py::dispatch_ready_tasks` + `max_concurrent`; `workflow_service.py::get_ready_tasks` (no open `blocks` deps) | `packages/sdlc/src/phases/generate-backend.ts::runScheduler` — dependency-ready logical tasks run concurrently up to `maxConcurrent`; completion unblocks dependents |
| risk-review gate (`risk_lenses` core) → synthesis → triage → `gates` (build/test/lint) | `packages/sdlc/src/gates/gate-pipeline.ts::runGatePipeline` + `risk-lens-*.md` / `risk-review-synthesis.md` / `risk-review-triage.md`; wired via the `runTaskGates` seam |
| a `needs_fixes` pass → human "Needs Clarification" | **DEVIATION:** bounded auto re-dispatch (see below) |
| single shared worktree + `--session-id` for all passes | **DEVIATION:** per-logical-task shared worktree; independent tasks isolated (see below) |

## Deviations (locked decisions)

1. **Bounded auto re-dispatch instead of a human gate.** When a review pass
   returns `needs_fixes`, CAHI auto re-dispatches the SAME pass with the review
   feedback appended, bounded by `PASS_MAX_FIX_ATTEMPTS` (initial + 2 fixes),
   then fails the task. taskmaster routes a `needs_fixes` pass to a human "Needs
   Clarification" wait; CAHI keeps the loop autonomous and bounded.
   (`generate-backend.ts::runPassWithFixLoop`, gated by the optional
   `readPassVerdict` seam — a review pass writes its verdict to
   `.cahi/sdlc-pass-verdict.json`.)

2. **Per-task shared worktree, not one shared worktree for everything.** A
   logical task's sequential passes SHARE that task's worktree (pass N reviews
   pass N-1 in place); INDEPENDENT tasks run in parallel each in their OWN
   worktree (CAHI's collision-safe isolation). No single-worktree-for-all-tasks
   rewrite.

## Invariants preserved

- **SDLC-only worktree scoping.** Worktree reuse is an explicit opt-in:
  `SessionSpawnConfig.worktreeKey` (set only by the SDLC scheduler, = the logical
  task id). The DEFAULT `workspace.create({sessionId})` →
  `worktrees/{sessionId}` path is untouched — every normal (non-SDLC) `cahi spawn`
  worker still gets exactly ONE isolated worktree per session. A regression test
  asserts this (`session-manager/spawn.test.ts`,
  `workspace-worktree/__tests__/index.test.ts`).
- **Shared-worktree ownership.** Only the pass that CREATES a shared worktree
  owns it; a pass that ATTACHES (`WorkspaceInfo.reused`) is marked
  `worktreeShared` in metadata, so its `kill` never destroys the checkout a
  sibling pass still needs, and it skips sibling re-mount + `postCreate`.
- **Single-task path + #6/#8/#11 preserved.** A task without expanded `passes`
  runs the legacy single-shot worker path unchanged (the safe default for
  trivial epics / older runs). Per-task model (#11), stall/auto-retry (#8), the
  session-backed lens runner + sentinel (#6), and resume (skip-done) all compose
  with the scheduler.
- **No lost writes under concurrency.** `RunStore.update` serializes its
  read-modify-write cycle so the parallel scheduler's concurrent
  `setTaskStatus`/`setTaskProgress`/`recordVerdict` updates can't clobber each
  other.
- **Cycles rejected** before any task is scheduled (`topoOrder`).
- **A failed task isolates its dependents** (they never become ready) while
  independent tasks keep running; the first failure is rethrown once in-flight
  work drains.

## Key files

- `packages/sdlc/src/passes/passes-config.ts` — pass catalog + complexity gating
- `packages/sdlc/src/passes/expand.ts` — logical task → chained passes
- `packages/sdlc/src/phases/generate-backend.ts` — scheduler + per-pass fix loop + gate seam
- `packages/sdlc/src/gates/gate-pipeline.ts` — risk → synthesis → triage → quality
- `packages/sdlc/src/runner/gate-pipeline-runner.ts` — live session-backed wiring
- `packages/sdlc/src/runner/pass-verdict.ts` — per-pass verdict sentinel
- `packages/core/src/session-manager.ts` + `packages/plugins/workspace-worktree/src/index.ts` — `worktreeKey` opt-in
