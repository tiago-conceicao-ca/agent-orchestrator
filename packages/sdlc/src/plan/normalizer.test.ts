import { describe, it, expect } from "vitest";
import { extractTaskSectionNames, normalizePlan } from "./normalizer";

const PLAN = `# X Implementation Plan
## Task: Repo layer
### Acceptance Criteria
- [ ] persists rows
## Task: Service layer
## Task Graph
\`\`\`yaml
tasks:
  - name: "Repo layer"
    complexity: LOW
    tdd: true
    depends_on: []
    summary: "DB access"
    acceptance_criteria: ["persists rows"]
  - name: "Service layer"
    complexity: MEDIUM
    tdd: true
    depends_on: ["Repo layer"]
    summary: "business logic"
\`\`\`
`;

describe("extractTaskSectionNames", () => {
  it("finds every ## Task: heading", () => {
    expect(extractTaskSectionNames(PLAN)).toEqual(["Repo layer", "Service layer"]);
  });
});

describe("normalizePlan", () => {
  it("produces an epic with tasks and a blocking edge", () => {
    const epic = normalizePlan(PLAN, { id: "epic-1", title: "X", description: "" });
    expect(epic.tasks.map((t) => t.title)).toEqual(["Repo layer", "Service layer"]);
    expect(epic.tasks.every((t) => t.status === "backlog")).toBe(true);
    expect(epic.dependencies).toHaveLength(1);
    const svc = epic.tasks.find((t) => t.title === "Service layer")!;
    const repo = epic.tasks.find((t) => t.title === "Repo layer")!;
    expect(epic.dependencies[0]).toMatchObject({
      taskId: svc.id,
      dependsOnTaskId: repo.id,
      type: "blocks",
    });
  });
  it("assigns each task a model from the complexity default map", () => {
    const epic = normalizePlan(PLAN, { id: "epic-1", title: "X", description: "" });
    const repo = epic.tasks.find((t) => t.title === "Repo layer")!;
    const svc = epic.tasks.find((t) => t.title === "Service layer")!;
    expect(repo.model).toBe("haiku"); // LOW → haiku
    expect(svc.model).toBe("sonnet"); // MEDIUM → sonnet
  });
  it("preserves an explicit model authored in the plan", () => {
    const withModel = PLAN.replace(
      'summary: "DB access"',
      'summary: "DB access"\n    model: opus',
    );
    const epic = normalizePlan(withModel, { id: "epic-1", title: "X", description: "" });
    const repo = epic.tasks.find((t) => t.title === "Repo layer")!;
    expect(repo.model).toBe("opus"); // explicit beats the LOW default (haiku)
  });
  it("expands each task into graduated lens passes and wires cross-task deps to terminal passes", () => {
    const epic = normalizePlan(PLAN, { id: "epic-1", title: "X", description: "" });
    const repo = epic.tasks.find((t) => t.title === "Repo layer")!; // LOW → 3 passes
    const svc = epic.tasks.find((t) => t.title === "Service layer")!; // MEDIUM → 4 passes
    expect(repo.passes!.map((p) => p.role)).toEqual(["initial", "correctness", "edge_cases"]);
    expect(svc.passes!).toHaveLength(4);
    // Service's initial pass waits for Repo's TERMINAL pass (edge_cases), not its initial.
    expect(svc.passes![0].waitsFor).toEqual([`${repo.id}__edge_cases`]);
  });
  it("throws with aggregated messages on an invalid plan", () => {
    const bad = PLAN.replace('depends_on: ["Repo layer"]', 'depends_on: ["Ghost"]');
    expect(() => normalizePlan(bad, { id: "e", title: "X", description: "" })).toThrow(
      /UNRESOLVED_DEPENDENCY|Ghost/,
    );
  });
});
