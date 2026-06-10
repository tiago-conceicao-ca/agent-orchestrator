import type { WorkflowDefinition } from "../workflow/types.js";

export const CA_PLAN_TO_BACKEND: WorkflowDefinition = {
  name: "ca-plan-to-backend",
  phases: [
    { id: "normalize-plan", executor: "normalize-plan", gates: ["tactical"], humanGate: true },
    { id: "generate-backend", executor: "generate-backend", gates: ["pattern-library"], humanGate: false },
  ],
};
