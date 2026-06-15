// Plan normalizer
export * from "./plan/types.js";
export { normalizePlan, extractTaskSectionNames } from "./plan/normalizer.js";

// Gates
export * from "./gates/types.js";
export { makeLensGate, loadLensPrompt, type AgentRunner, type LensName } from "./gates/lens-gate.js";
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
  sharedEpicBranch,
  GERAR_BACKEND_INSTRUCTION,
  type SpawnFn,
  type SpawnConfig,
  type WaitForDoneFn,
} from "./phases/generate-backend.js";
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
