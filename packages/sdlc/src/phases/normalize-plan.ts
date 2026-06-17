import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PhaseExecutor,
  PhaseContext,
  PhaseResult,
  RunContext,
} from "../workflow/types.js";
import { normalizePlan } from "../plan/normalizer.js";

/**
 * Turns loose input into a tm-style plan markdown. `ctx` carries the run id +
 * phase so a session-backed adapter can tag the plan-write session it spawns;
 * the headless adapter ignores it.
 */
export type AdaptToPlanFn = (input: string, ctx: RunContext) => Promise<string>;

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
      const planMarkdown = hasTaskGraph(ctx.input)
        ? ctx.input
        : await deps.adaptToPlan(ctx.input, { runId: ctx.run.id, phase: "normalize-plan" });
      const epic = normalizePlan(planMarkdown, {
        id: ctx.run.epicId,
        title: ctx.run.epicId,
        description: "",
      });
      for (const t of epic.tasks) await ctx.setTaskStatus(t.id, "backlog");
      // Write the normalized plan to a real file so the lens agent can Read it.
      const artifactRef = join(tmpdir(), `cahi-sdlc-${ctx.run.id}-plan.md`);
      writeFileSync(artifactRef, planMarkdown, "utf-8");
      // Return the plan markdown so the engine persists it durably on the run
      // (the tmpdir file above is ephemeral — only the lens agent reads it).
      return { epic, artifactRef, planMarkdown };
    },
  };
}
