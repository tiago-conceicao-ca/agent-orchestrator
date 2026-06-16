import type { WorkflowRun } from "@aoagents/ao-sdlc";

/** Client-safe SDLC kanban shapes + grouping logic (no node/server imports). */

/**
 * Selectable model aliases for the task-detail model selector. Client-safe
 * mirror of @aoagents/ao-sdlc `SDLC_MODELS` — kept here so the modal doesn't
 * pull the sdlc package's node deps (RunStore et al.) into the client bundle.
 * A test asserts this stays in sync with the source constant.
 */
export const SDLC_MODEL_OPTIONS = ["opus", "sonnet", "haiku"] as const;

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

/**
 * One graduated lens pass of a task, with its latest verdict (if it has run).
 * Surfaced in the task detail so the dashboard shows the initial → review-lens
 * pass chain (taskmaster-modelled) and which passes passed / need fixes.
 */
export interface TaskPassView {
  role: string;
  name: string;
  model: string;
  /** "pass" | "needs_fixes" from run.verdicts, or null if the pass hasn't run. */
  verdict: string | null;
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
  /** Graduated lens passes (initial → review lenses) with their latest verdicts. */
  passes: TaskPassView[];
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
 * A run abandoned under the OLD pre-#12 code persists as `status:"failed"` with
 * an abandon `lastError` (no distinct `abandoned` status existed yet). These are
 * the engine's two abandon messages: the manual default and the dead-engine
 * reconcile path (see `engine.abandon` / `reconcile` in @aoagents/ao-sdlc).
 */
const LEGACY_ABANDON_MESSAGES = [/^Run abandoned\.$/, /^Engine process .+ is no longer alive\.$/];

/**
 * Whether a run is abandoned — either the canonical `abandoned` status or a
 * legacy run abandoned before #12 (failed + an abandon `lastError`). The runs
 * list hides these; the deep-linked run page still loads them.
 */
export function isAbandoned(run: Pick<RunView, "status" | "lastError">): boolean {
  if (run.status === "abandoned") return true;
  if (run.status !== "failed") return false;
  const message = run.lastError?.message;
  return message !== undefined && LEGACY_ABANDON_MESSAGES.some((re) => re.test(message));
}

/**
 * Scope runs to a single project. `undefined` projectId is the all-projects
 * view (mirrors ReviewDashboard's `allProjectsView`) and returns every run.
 */
export function filterRunsByProject(runs: RunView[], projectId: string | undefined): RunView[] {
  if (!projectId) return runs;
  return runs.filter((run) => run.projectId === projectId);
}

/** Run-level recovery/gate actions, contextual to a run's status. */
export type RunActionKind = "approve" | "resume" | "abandon";

/**
 * Which run-level actions a status exposes (per-task retry lives on the task
 * panel). Approve gates an awaiting run; Resume re-drives a failed run; Abandon
 * is available for any not-already-abandoned run (it dismisses the run from the
 * list, so terminal failed/completed runs offer it too). Already-abandoned runs
 * expose nothing.
 */
export function availableRunActions(status: string): RunActionKind[] {
  switch (status) {
    case "awaiting_approval":
      return ["approve", "abandon"];
    case "running":
      return ["abandon"];
    case "failed":
      return ["resume", "abandon"];
    case "abandoned":
      return []; // already dismissed → no run-level actions
    default:
      return ["abandon"]; // completed (terminal) → abandon to dismiss
  }
}

/** Summarize a run's lens verdicts: pass/needs-fixes counts + the latest failing one. */
export function verdictSummary(verdicts: VerdictView[]): {
  passed: number;
  needsFixes: number;
  latestNeedsFixes: VerdictView | null;
} {
  let passed = 0;
  let needsFixes = 0;
  let latestNeedsFixes: VerdictView | null = null;
  for (const v of verdicts) {
    if (v.verdict === "pass") passed += 1;
    else {
      needsFixes += 1;
      latestNeedsFixes = v;
    }
  }
  return { passed, needsFixes, latestNeedsFixes };
}

/** The composite verdict-lens id a lens pass records, e.g. `impl:<taskId>:correctness`. */
export function passVerdictLens(taskId: string, role: string): string {
  return `impl:${taskId}:${role}`;
}

/** Categorize a verdict's lens for grouped display in the run view. */
export type VerdictCategory = "plan" | "pass" | "risk" | "synthesis" | "triage";

export function categorizeVerdict(lens: string): VerdictCategory {
  if (lens.startsWith("impl:")) return "pass";
  if (lens === "synthesis") return "synthesis";
  if (lens === "triage") return "triage";
  if (lens === "tactical" || lens === "architectural" || lens === "adversarial") return "plan";
  return "risk";
}

/**
 * The post-impl gate verdicts (risk lenses + synthesis), in order. These are the
 * risk-review pipeline outcomes surfaced in the run view, distinct from the
 * per-task lens-pass verdicts (which attach to their task) and the plan lenses.
 */
export function gateVerdicts(verdicts: VerdictView[]): VerdictView[] {
  return verdicts.filter((v) => {
    const cat = categorizeVerdict(v.lens);
    return cat === "risk" || cat === "synthesis";
  });
}

/** Total and per-bucket task counts for a board (for compact card summaries). */
export function taskTotals(board: Board): {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
} {
  return {
    total: COLUMNS.reduce((n, col) => n + board[col].length, 0),
    done: board.done.length,
    inProgress: board.in_progress.length,
    blocked: board.blocked.length,
  };
}
