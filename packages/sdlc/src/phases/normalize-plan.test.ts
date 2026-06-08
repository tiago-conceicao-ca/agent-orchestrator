import { describe, it, expect } from "vitest";
import { makeNormalizePlanExecutor } from "./normalize-plan";
import type { PhaseContext } from "../workflow/types";

const PLAN = `# X Implementation Plan
## Task: Repo
### Acceptance Criteria
- [ ] x
## Task Graph
\`\`\`yaml
tasks:
  - name: "Repo"
    complexity: LOW
    tdd: true
    depends_on: []
    summary: "s"
    acceptance_criteria: ["x"]
\`\`\`
`;

function makeCtx(input: string) {
  const statuses: Record<string, string> = {};
  const ctx: PhaseContext = {
    run: {
      id: "run-1",
      workflow: "w",
      epicId: "epic-1",
      status: "running",
      currentPhaseIndex: 0,
      phaseStates: {},
      taskStatus: {},
      verdicts: [],
      pendingApproval: null,
      createdAt: "2026-06-08T00:00:00Z",
    },
    epic: null,
    input,
    log: () => {},
    setTaskStatus: async (id, s) => {
      statuses[id] = s;
    },
  };
  return { ctx, statuses };
}

describe("normalize-plan executor", () => {
  it("normalizes a ready plan directly into an epic and seeds backlog status", async () => {
    const exec = makeNormalizePlanExecutor({
      adaptToPlan: async () => {
        throw new Error("should not be called");
      },
    });
    const { ctx, statuses } = makeCtx(PLAN);
    const result = await exec.run(ctx);
    expect(result.epic?.tasks[0].title).toBe("Repo");
    expect(statuses["epic-1__repo"]).toBe("backlog");
    expect(result.artifactRef).toMatch(/\.md$|plan/i);
  });
  it("calls the adapter when input has no Task Graph", async () => {
    let called = false;
    const exec = makeNormalizePlanExecutor({
      adaptToPlan: async () => {
        called = true;
        return PLAN;
      },
    });
    const { ctx } = makeCtx("just a loose idea, please plan it");
    const result = await exec.run(ctx);
    expect(called).toBe(true);
    expect(result.epic?.tasks[0].title).toBe("Repo");
  });
});
