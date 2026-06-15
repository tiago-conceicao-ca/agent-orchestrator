import type { PhaseExecutor, PhaseContext, PhaseResult, PrMode } from "../workflow/types.js";
import type { Epic, WorkflowTask } from "../plan/types.js";
import { taskDoneSentinelInstruction } from "../runner/task-sentinel.js";

export interface SpawnConfig {
  projectId: string;
  prompt: string;
  sdlcTaskId: string;
  metadata: Record<string, string>;
}
export type SpawnFn = (cfg: SpawnConfig) => Promise<{ id: string; workspacePath?: string }>;
/**
 * Polls AO until the spawned session completes; returns "done" | "failed".
 * `workspacePath` is where the worker's completion sentinel
 * (`.ao/sdlc-task-done.json`) is read from — the primary, PR-independent signal.
 */
export type WaitForDoneFn = (
  sessionId: string,
  workspacePath?: string,
) => Promise<"done" | "failed">;

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

export function makeGenerateBackendExecutor(deps: GenerateBackendDeps): PhaseExecutor {
  return {
    id: "generate-backend",
    async run(ctx: PhaseContext): Promise<PhaseResult> {
      if (!ctx.epic) throw new Error("generate-backend requires an epic from the prior phase.");
      // PR mode drives the worker's completion expectation: per-task workers open
      // their own PR; shared workers push one epic branch and complete via the
      // sentinel. A custom buildTaskPrompt (e.g. the smoke) overrides verbatim.
      const prMode: PrMode = ctx.run.prMode ?? "per-task";
      const epicBranch = prMode === "shared" ? sharedEpicBranch(ctx.epic.id) : undefined;
      const promptFor =
        deps.buildTaskPrompt ?? ((task) => previewTaskPrompt(task, undefined, { prMode, epicBranch }));
      const order = topoOrder(ctx.epic);
      const workspacePaths: string[] = [];
      for (const task of order) {
        await ctx.setTaskStatus(task.id, "in_progress");
        const { id: sessionId, workspacePath } = await deps.spawn({
          projectId: deps.projectId,
          prompt: promptFor(task),
          sdlcTaskId: task.id,
          metadata: { sdlcRunId: ctx.run.id, sdlcTaskId: task.id, sdlcPhase: "generate-backend" },
        });
        if (workspacePath) workspacePaths.push(workspacePath);
        const outcome = await deps.waitForDone(sessionId, workspacePath);
        if (outcome === "failed") {
          await ctx.setTaskStatus(task.id, "blocked");
          throw new Error(`Task '${task.title}' failed during backend generation.`);
        }
        await ctx.setTaskStatus(task.id, "done");
      }
      // Real artifact for the eval gate: the spawned task worktree path(s), one
      // per line. Falls back to an epic ref when no workspace path is available.
      return { artifactRef: workspacePaths.length ? workspacePaths.join("\n") : `epic:${ctx.epic.id}` };
    },
  };
}
