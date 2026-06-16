import type { Epic, TaskStatus } from "../plan/types.js";
import type { GateVerdict } from "../gates/types.js";

export type RunStatus = "running" | "awaiting_approval" | "completed" | "failed";

/**
 * How worker tasks land their work.
 * - `per-task` (default): each worker opens its OWN PR — the engine's native
 *   model; completion via the PR signal or the sentinel.
 * - `shared`: N tasks push to ONE shared epic branch and complete via the
 *   sentinel only, never requiring per-session PR ownership.
 */
export type PrMode = "per-task" | "shared";

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

/**
 * Per-task progress, tracked so a stalled worker is visible (not silently
 * polling) and auto-retries are recorded. `attempts` counts worker spawns for
 * the task (1 + auto-retries); `stalled` is true while a stall is unresolved.
 */
export interface TaskProgress {
  attempts: number;
  stalled: boolean;
  updatedAt: string;
}

/** Context handed to a PhaseExecutor; carries the evolving epic + a logger. */
export interface PhaseContext {
  run: WorkflowRun;
  epic: Epic | null; // null before normalize-plan produces it
  input: string; // raw input for phase 1
  log: (msg: string) => void;
  /** persisted hook so executors can update task status mid-phase (kanban). */
  setTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  /** persisted hook for per-task attempt/stall progress (`updatedAt` is stamped by the engine). */
  setTaskProgress: (taskId: string, progress: Omit<TaskProgress, "updatedAt">) => Promise<void>;
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
  /**
   * Optional: re-run a SINGLE task (for `ao sdlc retry`), reusing the persisted
   * epic. Implemented by executors whose work is per-task (generate-backend).
   */
  runTask?(ctx: PhaseContext, taskId: string): Promise<void>;
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
  /** PR landing mode for this run's worker tasks. Defaults to `per-task`. */
  prMode?: PrMode;
  /** Per-task attempt/stall progress, keyed by task id. */
  taskProgress?: Record<string, TaskProgress>;
  /** Last surfaced engine/gate failure (set on fail paths, abandon, reconcile). */
  lastError?: { phase: string; message: string };
  /** PID of the process currently driving this run — used to reconcile dead engines. */
  enginePid?: number;
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
