import { extractTaskGraphYaml, parseTaskGraph } from "../plan/parser.js";

export type PlanWriteRunner = (input: string) => Promise<string>;

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

/** @param run dispatches a plan-write agent; the prompt hint is appended by the caller (Task 16). */
export function makeInputAdapter(run: PlanWriteRunner): (input: string) => Promise<string> {
  return async (input: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const plan = await run(`${input}\n\n${PLAN_WRITE_PROMPT_HINT}`);
      if (parses(plan)) return plan;
    }
    throw new Error(
      "Input adapter could not produce a valid '## Task Graph' plan after 2 attempts.",
    );
  };
}
