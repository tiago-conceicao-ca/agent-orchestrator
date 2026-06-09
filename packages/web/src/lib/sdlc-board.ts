import type { WorkflowRun } from "@aoagents/ao-sdlc";

/** Client-safe SDLC kanban shapes + grouping logic (no node/server imports). */

export interface KanbanCard {
  taskId: string;
  title: string;
  status: string;
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
  board: Board;
}

function emptyBoard(): Board {
  return { backlog: [], ready: [], in_progress: [], in_review: [], done: [], blocked: [] };
}

/** Map task id → title from the run's persisted epic (empty when no epic yet). */
export function titlesFromRun(run: WorkflowRun): Record<string, string> {
  return Object.fromEntries((run.epic?.tasks ?? []).map((t) => [t.id, t.title]));
}

/** Group a run's tasks by status into kanban columns. Unknown statuses are ignored. */
export function toKanban(run: WorkflowRun, titles: Record<string, string>): Board {
  const board = emptyBoard();
  for (const [taskId, status] of Object.entries(run.taskStatus)) {
    const col = (board as Record<string, KanbanCard[]>)[status];
    if (col) col.push({ taskId, title: titles[taskId] ?? taskId, status });
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
