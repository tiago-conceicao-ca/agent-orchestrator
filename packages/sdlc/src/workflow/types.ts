import type { Epic, TaskStatus } from "../plan/types.js";
import type { GateVerdict } from "../gates/types.js";

export type RunStatus = "running" | "awaiting_approval" | "completed" | "failed";

export interface Phase {
  id: string;
  executor: string; // key into the executor registry
  gates: string[]; // lens names to run after the executor
  humanGate: boolean; // pause for human approval after gates pass
}

export interface WorkflowDefinition {
  name: string;
  phases: Phase[];
}

/** Context handed to a PhaseExecutor; carries the evolving epic + a logger. */
export interface PhaseContext {
  run: WorkflowRun;
  epic: Epic | null; // null before normalize-plan produces it
  input: string; // raw input for phase 1
  log: (msg: string) => void;
  /** persisted hook so executors can update task status mid-phase (kanban). */
  setTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
}

export interface PhaseResult {
  epic?: Epic; // normalize-plan returns the produced epic
  artifactRef: string; // path/handle to the phase's output, fed to gates
}

export interface PhaseExecutor {
  readonly id: string;
  run(ctx: PhaseContext): Promise<PhaseResult>;
}

export interface WorkflowRun {
  id: string;
  workflow: string;
  epicId: string;
  status: RunStatus;
  currentPhaseIndex: number;
  phaseStates: Record<string, "pending" | "running" | "passed" | "failed">;
  taskStatus: Record<string, string>;
  verdicts: GateVerdict[];
  pendingApproval: { phaseId: string; since: string } | null;
  createdAt: string;
  /**
   * The epic produced by `normalize-plan`, persisted so later phases (and a
   * resume after a human gate) can recover it — `advance()`'s local epic does
   * not survive the pause/resume boundary.
   */
  epic?: Epic;
}
