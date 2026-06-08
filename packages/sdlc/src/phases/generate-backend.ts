import type { PhaseExecutor, PhaseContext, PhaseResult } from "../workflow/types.js";
import type { Epic, WorkflowTask } from "../plan/types.js";

export interface SpawnConfig {
  projectId: string;
  prompt: string;
  sdlcTaskId: string;
  metadata: Record<string, string>;
}
export type SpawnFn = (cfg: SpawnConfig) => Promise<{ id: string }>;
/** Polls AO until the spawned session reaches a terminal state; returns "done" | "failed". */
export type WaitForDoneFn = (sessionId: string) => Promise<"done" | "failed">;

export interface GenerateBackendDeps {
  spawn: SpawnFn; // wraps SessionManager.spawn (Task 16 wires the real one)
  waitForDone: WaitForDoneFn;
  projectId: string;
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

function backendPrompt(task: WorkflowTask): string {
  const ac = task.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
  return [
    `Run the /gerar-backend skill to implement this task.`,
    `Task: ${task.title}`,
    `Summary: ${task.summary}`,
    `Acceptance criteria:\n${ac}`,
    `When done, open a PR.`,
  ].join("\n\n");
}

export function makeGenerateBackendExecutor(deps: GenerateBackendDeps): PhaseExecutor {
  return {
    id: "generate-backend",
    async run(ctx: PhaseContext): Promise<PhaseResult> {
      if (!ctx.epic) throw new Error("generate-backend requires an epic from the prior phase.");
      const order = topoOrder(ctx.epic);
      for (const task of order) {
        await ctx.setTaskStatus(task.id, "in_progress");
        const { id: sessionId } = await deps.spawn({
          projectId: deps.projectId,
          prompt: backendPrompt(task),
          sdlcTaskId: task.id,
          metadata: { sdlcRunId: ctx.run.id, sdlcTaskId: task.id, sdlcPhase: "generate-backend" },
        });
        const outcome = await deps.waitForDone(sessionId);
        if (outcome === "failed") {
          await ctx.setTaskStatus(task.id, "blocked");
          throw new Error(`Task '${task.title}' failed during backend generation.`);
        }
        await ctx.setTaskStatus(task.id, "done");
      }
      return { artifactRef: `epic:${ctx.epic.id}` };
    },
  };
}
