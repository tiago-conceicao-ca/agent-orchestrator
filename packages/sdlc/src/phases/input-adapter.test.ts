import { describe, it, expect } from "vitest";
import { makeInputAdapter } from "./input-adapter";

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
    expect(await adapt("loose idea")).toContain("## Task Graph");
  });
  it("retries once then throws if the agent never produces a valid Task Graph", async () => {
    let calls = 0;
    const adapt = makeInputAdapter(async () => {
      calls++;
      return "no graph here";
    });
    await expect(adapt("loose idea")).rejects.toThrow(/Task Graph/i);
    expect(calls).toBe(2); // initial + one retry
  });
});
