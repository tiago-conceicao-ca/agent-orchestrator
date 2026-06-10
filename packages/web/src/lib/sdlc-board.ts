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
