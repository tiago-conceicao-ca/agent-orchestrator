import type { Epic, TaskStatus } from "../plan/types.js";
import type { GateVerdict } from "../gates/types.js";

export type RunStatus = "running" | "awaiting_approval" | "completed" | "failed";

/**
 * Position within a workflow run, threaded from `engine.advance` into the gate
 * and plan-write seams so session-backed runners can tag the sessions they spawn
 * (`sdlcRunId`/`sdlcPhase`). The headless impls ignore it.
 */
export interface RunContext {
  runId: string;
  phase: string;
}

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
  /**
   * The normalized plan markdown. normalize-plan returns it so the engine can
   * persist it durably on the run (`run.planMarkdown`) — the `artifactRef`
   * tmpdir file is ephemeral and only exists for the lens agent to Read.
   */
  planMarkdown?: string;
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
  /**
   * The normalized plan markdown produced by `normalize-plan`, persisted so the
   * run view can show the plan artifact that the lens agents reviewed.
   */
  planMarkdown?: string;
}
