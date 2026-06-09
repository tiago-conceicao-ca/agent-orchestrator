import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PhaseExecutor, PhaseContext, PhaseResult } from "../workflow/types.js";
import { normalizePlan } from "../plan/normalizer.js";

/** Turns loose input into a tm-style plan markdown (Task 15 supplies the agent-backed impl). */
export type AdaptToPlanFn = (input: string) => Promise<string>;

export interface NormalizePlanDeps {
  adaptToPlan: AdaptToPlanFn;
}

function hasTaskGraph(input: string): boolean {
  return /##\s+Task\s+Graph\s*\n+```ya?ml/i.test(input);
}

export function makeNormalizePlanExecutor(deps: NormalizePlanDeps): PhaseExecutor {
  return {
    id: "normalize-plan",
    async run(ctx: PhaseContext): Promise<PhaseResult> {
      const planMarkdown = hasTaskGraph(ctx.input) ? ctx.input : await deps.adaptToPlan(ctx.input);
      const epic = normalizePlan(planMarkdown, {
        id: ctx.run.epicId,
        title: ctx.run.epicId,
        description: "",
      });
      for (const t of epic.tasks) await ctx.setTaskStatus(t.id, "backlog");
      // Write the normalized plan to a real file so the lens agent can Read it.
      const artifactRef = join(tmpdir(), `ao-sdlc-${ctx.run.id}-plan.md`);
      writeFileSync(artifactRef, planMarkdown, "utf-8");
      return { epic, artifactRef };
    },
  };
}
