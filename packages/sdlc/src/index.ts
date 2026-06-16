// Plan normalizer
export * from "./plan/types.js";
export { normalizePlan, extractTaskSectionNames } from "./plan/normalizer.js";

// Graduated lens-pass config (taskmaster implement.passes + complexity gating)
export {
  PASS_ROLES,
  PASS_DEFS,
  COMPLEXITY_PASSES,
  passesForComplexity,
  isReviewPass,
  type PassRole,
  type PassDef,
} from "./passes/passes-config.js";
export { expandTaskPasses, passId } from "./passes/expand.js";

// Gates
export * from "./gates/types.js";
export {
  makeLensGate,
  loadLensPrompt,
  loadPromptTemplate,
  type AgentRunner,
  type LensName,
} from "./gates/lens-gate.js";
export { makePatternLibraryGate, type EvalCommandRunner } from "./gates/pattern-library-gate.js";
export { smokeEvalArtifact } from "./gates/smoke-eval.js";

// Workflow engine
export * from "./workflow/types.js";
export { WorkflowEngine, type EngineDeps } from "./workflow/engine.js";
export { RunStore } from "./workflow/run-store.js";

// Phase executors
export { makeNormalizePlanExecutor, type AdaptToPlanFn } from "./phases/normalize-plan.js";
export {
  makeGenerateBackendExecutor,
  previewTaskPrompt,
  taskCompletionDirective,
  reviewPassCompletionDirective,
  buildPassPrompt,
  sharedEpicBranch,
  GERAR_BACKEND_INSTRUCTION,
  TASK_MAX_ATTEMPTS,
  DEFAULT_MAX_CONCURRENT,
  PASS_MAX_FIX_ATTEMPTS,
  type SpawnFn,
  type SpawnConfig,
  type WaitForDoneFn,
  type GenerateBackendDeps,
  type ReadPassVerdictFn,
} from "./phases/generate-backend.js";
export {
  readPassVerdictSentinel,
  passVerdictSentinelInstruction,
  PASS_VERDICT_SENTINEL,
} from "./runner/pass-verdict.js";
export { makeInputAdapter, type PlanWriteRunner } from "./phases/input-adapter.js";

// V1 workflow definition
export { CA_PLAN_TO_BACKEND } from "./workflows/ca-plan-to-backend.js";

// Session-backed agent runner (sentinel-file output contract)
export {
  runSessionBackedAgent,
  type SdlcSessionSpawn,
  type RunSessionBackedAgentParams,
} from "./runner/session-runner.js";
export {
  makeSessionLensRunner,
  makeSessionPlanRunner,
  LENS_SENTINEL,
  PLAN_SENTINEL,
} from "./runner/sdlc-agent-runners.js";

// Worker-task completion sentinel (PR-independent "task done" signal)
export {
  TASK_DONE_SENTINEL,
  readTaskSentinel,
  classifyTaskSentinel,
  taskDoneSentinelInstruction,
  type TaskDoneSentinel,
} from "./runner/task-sentinel.js";
export {
  waitForTaskCompletion,
  type TaskOutcome,
  type WaitForTaskParams,
} from "./runner/wait-for-done.js";

// Run-event wiring: turns the engine's pure onRunEvent seam into orchestrator
// notifications, activity events, and human notifier routing.
export {
  makeSdlcRunEventHandler,
  type SdlcRunEventNotifierDeps,
} from "./runner/run-event-notifier.js";
