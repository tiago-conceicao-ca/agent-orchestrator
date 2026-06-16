import type { WorkflowRun } from "@aoagents/ao-sdlc";

/** Client-safe SDLC kanban shapes + grouping logic (no node/server imports). */

export interface KanbanCard {
  /** Stable T-number (1-based, in run/plan order) shown on the card. */
  number: number;
  taskId: string;
  title: string;
  status: string;
}

/** A dispatched AO session linked to a task (metadata.sdlcTaskId === task.id). */
export interface LinkedSession {
  sessionId: string;
  projectId: string;
  /** Dashboard route to the session detail view. */
  projectSessionPath: string;
}

/** Read-only, fully-enriched task detail consumed by the SDLC detail panel. */
export interface SdlcTaskDetail {
  number: number; // T1..Tn in run order
  id: string;
  title: string;
  status: string; // live status (run.taskStatus) with the epic task as fallback
  summary: string;
  acceptanceCriteria: string[];
  dependsOn: string[]; // dependency task TITLES
  complexity: string;
  tdd: boolean;
  agent: string; // the agent the generate-backend phase dispatches (claude-code)
  model: string | null; // dispatched session's model when known
  createdAt: string;
  updatedAt: string;
  prompt: string; // the exact agent prompt (previewTaskPrompt output)
  linkedSession: LinkedSession | null; // null = not dispatched
  /** Worker spawns for this task (1 + auto-retries); 0 when never dispatched. */
  attempts: number;
  /** True while this task's worker is stalled (no completion signal). */
  stalled: boolean;
}

export type BoardColumn = "backlog" | "ready" | "in_progress" | "in_review" | "done" | "blocked";

export type Board = Record<BoardColumn, KanbanCard[]>;

export const COLUMNS: BoardColumn[] = [
  "backlog",
  "ready",
  "in_progress",
  "in_review",
  "done",
  "blocked",
];

/** A workflow phase's id + its run state, in run (definition) order. */
export interface PhaseStateView {
  id: string;
  state: string; // "pending" | "running" | "passed" | "failed"
}

/** A single lens issue surfaced on a verdict. */
export interface VerdictIssueView {
  severity: string;
  title: string;
  detail: string;
}

/** Slim, client-safe view of a persisted lens verdict (with captured reasoning). */
export interface VerdictView {
  lens: string;
  verdict: string; // "pass" | "needs_fixes"
  issues: VerdictIssueView[];
  /** The lens agent's captured output (reasoning + verdict), when available. */
  rawOutput: string | null;
}

export interface RunView {
  id: string;
  projectId: string;
  workflow: string;
  status: string;
  pendingApproval: WorkflowRun["pendingApproval"];
  createdAt: string;
  board: Board;
  /** Enriched, read-only task detail (one per epic task) for the detail panel. */
  tasks: SdlcTaskDetail[];
  /** Per-phase run state, in definition order (e.g. normalize-plan → generate-backend). */
  phaseStates: PhaseStateView[];
  /** Lens verdict history (one per gate evaluation), in evaluation order. */
  verdicts: VerdictView[];
  /** The normalized plan markdown the lens agents reviewed; null when not persisted. */
  planArtifact: string | null;
  /** Last surfaced engine/gate failure (fail paths, abandon, reconcile); null when none. */
  lastError: { phase: string; message: string } | null;
  /** PR landing mode for this run's worker tasks (defaults to per-task). */
  prMode: string;
}

/** Map a run's phaseStates record to an ordered, serializable view. */
export function toPhaseStates(run: WorkflowRun): PhaseStateView[] {
  return Object.entries(run.phaseStates).map(([id, state]) => ({ id, state }));
}

/** Map a run's persisted verdicts to the slim client view (issues + captured output). */
export function toVerdictViews(run: WorkflowRun): VerdictView[] {
  return (run.verdicts ?? []).map((v) => ({
    lens: v.lens,
    verdict: v.verdict,
    issues: (v.issues ?? []).map((i) => ({
      severity: i.severity,
      title: i.title,
      detail: i.detail,
    })),
    rawOutput: v.rawOutput ?? null,
  }));
}

/** The normalized plan markdown persisted on the run (null when absent). */
export function planArtifactFromRun(run: WorkflowRun): string | null {
  return run.planMarkdown ?? null;
}

/** The last surfaced engine/gate failure on the run (null when none). */
export function lastErrorFromRun(run: WorkflowRun): { phase: string; message: string } | null {
  return run.lastError ?? null;
}

function emptyBoard(): Board {
  return { backlog: [], ready: [], in_progress: [], in_review: [], done: [], blocked: [] };
}

/** Map task id → title from the run's persisted epic (empty when no epic yet). */
export function titlesFromRun(run: WorkflowRun): Record<string, string> {
  return Object.fromEntries((run.epic?.tasks ?? []).map((t) => [t.id, t.title]));
}

/**
 * Assign each task a stable 1-based T-number in run order. The canonical order
 * is the epic's task list (== plan order); when no epic exists yet we fall back
 * to taskStatus insertion order so cards still number deterministically.
 */
export function assignTaskNumbers(run: WorkflowRun): Record<string, number> {
  const ids = run.epic?.tasks?.length
    ? run.epic.tasks.map((t) => t.id)
    : Object.keys(run.taskStatus);
  return Object.fromEntries(ids.map((id, i) => [id, i + 1]));
}

/** Resolve a task's blocking dependencies to their task TITLES (ids as fallback). */
export function dependsOnTitles(run: WorkflowRun, taskId: string): string[] {
  const titles = titlesFromRun(run);
  return (run.epic?.dependencies ?? [])
    .filter((d) => d.taskId === taskId)
    .map((d) => titles[d.dependsOnTaskId] ?? d.dependsOnTaskId);
}

/** Group a run's tasks by status into kanban columns. Unknown statuses are ignored. */
export function toKanban(
  run: WorkflowRun,
  titles: Record<string, string>,
  numbers: Record<string, number> = assignTaskNumbers(run),
): Board {
  const board = emptyBoard();
  for (const [taskId, status] of Object.entries(run.taskStatus)) {
    const col = (board as Record<string, KanbanCard[]>)[status];
    if (col) col.push({ number: numbers[taskId] ?? 0, taskId, title: titles[taskId] ?? taskId, status });
  }
  return board;
}

/**
 * Scope runs to a single project. `undefined` projectId is the all-projects
 * view (mirrors ReviewDashboard's `allProjectsView`) and returns every run.
 */
export function filterRunsByProject(runs: RunView[], projectId: string | undefined): RunView[] {
  if (!projectId) return runs;
  return runs.filter((run) => run.projectId === projectId);
}
