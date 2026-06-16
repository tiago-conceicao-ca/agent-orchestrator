import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowEngine } from "../workflow/engine";
import { RunStore } from "../workflow/run-store";
import { makeNormalizePlanExecutor } from "../phases/normalize-plan";
import { makeGenerateBackendExecutor } from "../phases/generate-backend";
import { makeLensGate } from "../gates/lens-gate";
import { makePatternLibraryGate } from "../gates/pattern-library-gate";
import { CA_PLAN_TO_BACKEND } from "./ca-plan-to-backend";

const PLAN = `# Feature Implementation Plan
## Task: Repo layer
### Acceptance Criteria
- [ ] persists
## Task: Service layer
## Task Graph
\`\`\`yaml
tasks:
  - name: "Repo layer"
    complexity: LOW
    tdd: true
    depends_on: []
    summary: "db"
    acceptance_criteria: ["persists"]
  - name: "Service layer"
    complexity: MEDIUM
    tdd: true
    depends_on: ["Repo layer"]
    summary: "logic"
\`\`\`
`;

describe("ca-plan-to-backend end-to-end", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "e2e-"));
  });

  it("normalizes, pauses at the human gate, then on approval generates backend per task in order", async () => {
    const spawned: string[] = [];
    const engine = new WorkflowEngine({
      store: new RunStore(dir),
      definitions: { [CA_PLAN_TO_BACKEND.name]: CA_PLAN_TO_BACKEND },
      executors: {
        "normalize-plan": makeNormalizePlanExecutor({ adaptToPlan: async () => PLAN }),
        "generate-backend": makeGenerateBackendExecutor({
          projectId: "backend",
          spawn: async (cfg) => {
            spawned.push(cfg.sdlcTaskId);
            return { id: `s-${spawned.length}` };
          },
          waitForDone: async () => "done",
        }),
      },
      gates: {
        tactical: makeLensGate("tactical", "{artifact}", async () => '{"verdict":"pass","issues":[]}'),
        "pattern-library": makePatternLibraryGate(async () => '{"passed":true,"score":1,"findings":[]}'),
      },
    });

    const run = await engine.start("ca-plan-to-backend", "epic-1", PLAN);

    // paused at human gate after normalize-plan
    let s = await engine.load(run.id);
    expect(s?.status).toBe("awaiting_approval");
    expect(s?.pendingApproval?.phaseId).toBe("normalize-plan");
    expect(Object.values(s!.taskStatus)).toContain("backlog"); // backlog visible on kanban

    // approve → backend phase runs, tasks in dependency order
    await engine.resume(run.id);
    s = await engine.load(run.id);
    expect(s?.status).toBe("completed");
    // Each logical task expands into graduated lens passes: Repo (LOW) → 3,
    // Service (MEDIUM) → 4. Repo's passes all precede Service's (dependency order).
    expect(spawned.filter((id) => id === "epic-1__repo-layer")).toHaveLength(3);
    expect(spawned.filter((id) => id === "epic-1__service-layer")).toHaveLength(4);
    expect(spawned.lastIndexOf("epic-1__repo-layer")).toBeLessThan(
      spawned.indexOf("epic-1__service-layer"),
    );
    expect(s?.taskStatus["epic-1__repo-layer"]).toBe("done");
  });

  it("fails the run (no backend spawned) when the tactical lens returns needs_fixes", async () => {
    const spawned: string[] = [];
    const engine = new WorkflowEngine({
      store: new RunStore(dir),
      definitions: { [CA_PLAN_TO_BACKEND.name]: CA_PLAN_TO_BACKEND },
      executors: {
        "normalize-plan": makeNormalizePlanExecutor({ adaptToPlan: async () => PLAN }),
        "generate-backend": makeGenerateBackendExecutor({
          projectId: "b",
          spawn: async (c) => {
            spawned.push(c.sdlcTaskId);
            return { id: "s" };
          },
          waitForDone: async () => "done",
        }),
      },
      gates: {
        tactical: makeLensGate(
          "tactical",
          "{artifact}",
          async () => '{"verdict":"needs_fixes","issues":[{"severity":"high","title":"x","detail":"y"}]}',
        ),
        "pattern-library": makePatternLibraryGate(async () => '{"passed":true,"score":1}'),
      },
    });
    const run = await engine.start("ca-plan-to-backend", "epic-2", PLAN);
    const s = await engine.load(run.id);
    expect(s?.status).toBe("failed");
    expect(spawned).toEqual([]); // never reached backend phase
  });
});
