import { describe, it, expect } from "vitest";
import type { RunContext } from "../workflow/types";
import { makeInputAdapter } from "./input-adapter";

const CTX: RunContext = { runId: "run-1", phase: "normalize-plan" };

const VALID_PLAN = `# X Implementation Plan
## Task: Repo
## Task Graph
\`\`\`yaml
tasks:
  - name: "Repo"
    complexity: LOW
    tdd: true
    depends_on: []
    summary: "s"
\`\`\`
`;

describe("input adapter", () => {
  it("returns the agent-produced plan when it parses", async () => {
    const adapt = makeInputAdapter(async () => VALID_PLAN);
    expect(await adapt("loose idea", CTX)).toContain("## Task Graph");
  });
  it("retries once then throws if the agent never produces a valid Task Graph", async () => {
    let calls = 0;
    const adapt = makeInputAdapter(async () => {
      calls++;
      return "no graph here";
    });
    await expect(adapt("loose idea", CTX)).rejects.toThrow(/Task Graph/i);
    expect(calls).toBe(2); // initial + one retry
  });
  it("forwards the run context to the plan-write runner", async () => {
    let seen: RunContext | undefined;
    const adapt = makeInputAdapter(async (_input, ctx) => {
      seen = ctx;
      return VALID_PLAN;
    });
    await adapt("loose idea", { runId: "run-7", phase: "normalize-plan" });
    expect(seen).toEqual({ runId: "run-7", phase: "normalize-plan" });
  });
});
