import type { PhaseExecutor, PhaseContext, PhaseResult, PrMode } from "../workflow/types.js";
import type { Epic, WorkflowTask } from "../plan/types.js";
import { taskDoneSentinelInstruction } from "../runner/task-sentinel.js";
import type { TaskOutcome } from "../runner/wait-for-done.js";

export interface SpawnConfig {
  projectId: string;
  prompt: string;
  sdlcTaskId: string;
  metadata: Record<string, string>;
}
export type SpawnFn = (cfg: SpawnConfig) => Promise<{ id: string; workspacePath?: string }>;
/**
 * Polls AO until the spawned session completes; returns "done" | "failed" |
 * "stalled". `workspacePath` is where the worker's completion sentinel
 * (`.ao/sdlc-task-done.json`) is read from — the primary, PR-independent signal.
 * "stalled" lets the executor auto-retry before failing the run.
 */
export type WaitForDoneFn = (
  sessionId: string,
  workspacePath?: string,
) => Promise<TaskOutcome>;

/** Worker spawns per task before giving up: the initial attempt + one auto-retry. */
export const TASK_MAX_ATTEMPTS = 2;

export interface GenerateBackendDeps {
  spawn: SpawnFn; // wraps SessionManager.spawn (Task 16 wires the real one)
  waitForDone: WaitForDoneFn;
  projectId: string;
  /**
   * Build the per-task generation instruction. Defaults to the canonical
   * `/gerar-backend` wording; the smoke injects a generic (e.g. plain Node.js)
   * instruction so it needn't satisfy that skill's workspace prerequisites.
   */
  buildTaskPrompt?: (task: WorkflowTask) => string;
}

/** Kahn topological order over the epic's blocking edges. */
function topoOrder(epic: Epic): WorkflowTask[] {
  const byId = new Map(epic.tasks.map((t) => [t.id, t]));
  const inDeg = new Map(epic.tasks.map((t) => [t.id, 0]));
  const adj = new Map<string, string[]>(epic.tasks.map((t) => [t.id, []]));
  for (const d of epic.dependencies) {
    // dependsOn -> task
    adj.get(d.dependsOnTaskId)!.push(d.taskId);
    inDeg.set(d.taskId, inDeg.get(d.taskId)! + 1);
  }
  const q = epic.tasks.filter((t) => inDeg.get(t.id) === 0).map((t) => t.id);
  const order: WorkflowTask[] = [];
  while (q.length) {
    const id = q.shift()!;
    order.push(byId.get(id)!);
    for (const m of adj.get(id)!) {
      inDeg.set(m, inDeg.get(m)! - 1);
      if (inDeg.get(m) === 0) q.push(m);
    }
  }
  if (order.length !== epic.tasks.length) throw new Error("Cycle in epic dependencies.");
  return order;
}

/** Canonical /gerar-backend wording used as the default generation instruction. */
export const GERAR_BACKEND_INSTRUCTION = "Run the /gerar-backend skill to implement this task.";

/** Shared epic branch name workers push to in `shared` PR mode. */
export function sharedEpicBranch(epicId: string): string {
  return `sdlc/${epicId}`;
}

/**
 * The per-task completion + sentinel directive, selected by PR mode.
 * - per-task: open your own PR, then write the sentinel (with PR fields).
 * - shared: push to the shared epic branch (no own PR), then write the sentinel.
 */
export function taskCompletionDirective(prMode: PrMode, epicBranch?: string): string {
  if (prMode === "shared") {
    const branch = epicBranch ? ` \`${epicBranch}\`` : "";
    return [
      `When done, push your commits to the shared epic branch${branch}. Do NOT open your ` +
        `own PR — every task in this epic lands in ONE shared PR off that branch.`,
      taskDoneSentinelInstruction({ withPr: false }),
    ].join("\n\n");
  }
  return [`When done, open a PR.`, taskDoneSentinelInstruction({ withPr: true })].join("\n\n");
}

/**
 * Pure render of the per-task agent prompt. This is the single source of truth
 * for what the generate-backend executor dispatches to a spawned session, reused
 * by the dashboard to show a read-only preview of the exact prompt per task.
 * `generationInstruction` defaults to the canonical /gerar-backend wording; the
 * smoke injects a generic instruction so it needn't satisfy that skill's
 * workspace prerequisites.
 */
export function previewTaskPrompt(
  task: WorkflowTask,
  generationInstruction: string = GERAR_BACKEND_INSTRUCTION,
  opts: { prMode?: PrMode; epicBranch?: string } = {},
): string {
  const ac = task.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
  return [
    generationInstruction,
    `Task: ${task.title}`,
    `Summary: ${task.summary}`,
    `Acceptance criteria:\n${ac}`,
    taskCompletionDirective(opts.prMode ?? "per-task", opts.epicBranch),
  ].join("\n\n");
}

/** Resolve the per-task prompt builder from PR mode (+ optional custom override). */
function makePromptFor(deps: GenerateBackendDeps, epic: Epic, prMode: PrMode) {
  const epicBranch = prMode === "shared" ? sharedEpicBranch(epic.id) : undefined;
  return (
    deps.buildTaskPrompt ?? ((task: WorkflowTask) => previewTaskPrompt(task, undefined, { prMode, epicBranch }))
  );
}

/**
 * Spawn one task's worker and wait for completion, auto-retrying ONCE on a stall.
 * Records per-task attempt/stall progress; throws (task → blocked) on failure or
 * a stall that survives the retry. Returns the worker's workspace path, if any.
 */
async function runTaskWithRetry(
  deps: GenerateBackendDeps,
  ctx: PhaseContext,
  task: WorkflowTask,
  promptFor: (task: WorkflowTask) => string,
): Promise<{ workspacePath?: string }> {
  let lastWorkspace: string | undefined;
  for (let attempt = 1; attempt <= TASK_MAX_ATTEMPTS; attempt++) {
    await ctx.setTaskStatus(task.id, "in_progress");
    const { id: sessionId, workspacePath } = await deps.spawn({
      projectId: deps.projectId,
      prompt: promptFor(task),
      sdlcTaskId: task.id,
      metadata: { sdlcRunId: ctx.run.id, sdlcTaskId: task.id, sdlcPhase: "generate-backend" },
    });
    lastWorkspace = workspacePath;
    const outcome: TaskOutcome = await deps.waitForDone(sessionId, workspacePath);

    if (outcome === "done") {
      await ctx.setTaskProgress(task.id, { attempts: attempt, stalled: false });
      await ctx.setTaskStatus(task.id, "done");
      return { workspacePath };
    }

    const canRetry = outcome === "stalled" && attempt < TASK_MAX_ATTEMPTS;
    await ctx.setTaskProgress(task.id, { attempts: attempt, stalled: outcome === "stalled" });
    if (canRetry) {
      ctx.log(`Task '${task.title}' stalled (attempt ${attempt}); auto-retrying.`);
      continue;
    }
    await ctx.setTaskStatus(task.id, "blocked");
    const why = outcome === "stalled" ? "stalled after auto-retry" : "failed";
    throw new Error(`Task '${task.title}' ${why} during backend generation.`);
  }
  // Unreachable: the loop always returns or throws.
  return { workspacePath: lastWorkspace };
}

export function makeGenerateBackendExecutor(deps: GenerateBackendDeps): PhaseExecutor {
  return {
    id: "generate-backend",
    async run(ctx: PhaseContext): Promise<PhaseResult> {
      if (!ctx.epic) throw new Error("generate-backend requires an epic from the prior phase.");
      // PR mode drives the worker's completion expectation: per-task workers open
      // their own PR; shared workers push one epic branch and complete via the
      // sentinel. A custom buildTaskPrompt (e.g. the smoke) overrides verbatim.
      const prMode: PrMode = ctx.run.prMode ?? "per-task";
      const promptFor = makePromptFor(deps, ctx.epic, prMode);
      const order = topoOrder(ctx.epic);
      const workspacePaths: string[] = [];
      for (const task of order) {
        // Resume: skip tasks a prior run already completed.
        if (ctx.run.taskStatus[task.id] === "done") continue;
        const { workspacePath } = await runTaskWithRetry(deps, ctx, task, promptFor);
        if (workspacePath) workspacePaths.push(workspacePath);
      }
      // Real artifact for the eval gate: the spawned task worktree path(s), one
      // per line. Falls back to an epic ref when no workspace path is available.
      return { artifactRef: workspacePaths.length ? workspacePaths.join("\n") : `epic:${ctx.epic.id}` };
    },
    async runTask(ctx: PhaseContext, taskId: string): Promise<void> {
      if (!ctx.epic) throw new Error("generate-backend runTask requires an epic.");
      const task = ctx.epic.tasks.find((t) => t.id === taskId);
      if (!task) throw new Error(`Task '${taskId}' not found in epic '${ctx.epic.id}'.`);
      const prMode: PrMode = ctx.run.prMode ?? "per-task";
      const promptFor = makePromptFor(deps, ctx.epic, prMode);
      await runTaskWithRetry(deps, ctx, task, promptFor);
    },
  };
}
