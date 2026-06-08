// Plan normalizer
export * from "./plan/types.js";
export { normalizePlan, extractTaskSectionNames } from "./plan/normalizer.js";

// Gates
export * from "./gates/types.js";
export { makeLensGate, type AgentRunner } from "./gates/lens-gate.js";
export { makePatternLibraryGate, type EvalCommandRunner } from "./gates/pattern-library-gate.js";

// Workflow engine
export * from "./workflow/types.js";
export { WorkflowEngine, type EngineDeps } from "./workflow/engine.js";
export { RunStore } from "./workflow/run-store.js";

// Phase executors
export { makeNormalizePlanExecutor, type AdaptToPlanFn } from "./phases/normalize-plan.js";
export {
  makeGenerateBackendExecutor,
  type SpawnFn,
  type SpawnConfig,
  type WaitForDoneFn,
} from "./phases/generate-backend.js";
export { makeInputAdapter, type PlanWriteRunner } from "./phases/input-adapter.js";

// V1 workflow definition
export { CA_PLAN_TO_BACKEND } from "./workflows/ca-plan-to-backend.js";
