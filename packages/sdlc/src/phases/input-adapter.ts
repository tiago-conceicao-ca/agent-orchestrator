import type { RunContext } from "../workflow/types.js";
import { extractTaskGraphYaml, parseTaskGraph } from "../plan/parser.js";
import type { AdaptToPlanFn } from "./normalize-plan.js";

export type PlanWriteRunner = (input: string, ctx: RunContext) => Promise<string>;

const PLAN_WRITE_PROMPT_HINT =
  "Produce an implementation plan with a '## Task Graph' YAML block (tm plan-structure).";

function parses(plan: string): boolean {
  try {
    parseTaskGraph(extractTaskGraphYaml(plan));
    return true;
  } catch {
    return false;
  }
}

/** @param run dispatches a plan-write agent; the prompt hint is appended below. */
export function makeInputAdapter(run: PlanWriteRunner): AdaptToPlanFn {
  return async (input: string, ctx: RunContext) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const plan = await run(`${input}\n\n${PLAN_WRITE_PROMPT_HINT}`, ctx);
      if (parses(plan)) return plan;
    }
    throw new Error(
      "Input adapter could not produce a valid '## Task Graph' plan after 2 attempts.",
    );
  };
}
