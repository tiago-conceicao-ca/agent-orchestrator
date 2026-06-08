import { describe, it, expect } from "vitest";
import type { WorkflowDefinition, Phase, WorkflowRun } from "./types";

describe("workflow types", () => {
  it("a phase can be marked as a human gate", () => {
    const phase: Phase = {
      id: "normalize-plan",
      executor: "normalize-plan",
      gates: ["tactical"],
      humanGate: true,
    };
    expect(phase.humanGate).toBe(true);
  });
  it("a workflow definition lists phases", () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [{ id: "p1", executor: "p1", gates: [], humanGate: false }],
    };
    expect(def.phases).toHaveLength(1);
  });
  it("a run tracks current phase and per-task status", () => {
    const run: WorkflowRun = {
      id: "run-1",
      workflow: "ca-plan-to-backend",
      epicId: "epic-1",
      status: "running",
      currentPhaseIndex: 0,
      phaseStates: {},
      taskStatus: {},
      verdicts: [],
      pendingApproval: null,
      createdAt: "2026-06-08T00:00:00Z",
    };
    expect(run.status).toBe("running");
  });
});
