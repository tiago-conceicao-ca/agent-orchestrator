import { describe, it, expect } from "vitest";
import type { TaskGraph, TaskGraphTask, Epic, WorkflowTask, Dependency } from "./types";
import { COMPLEXITY } from "./types";

describe("plan types", () => {
  it("COMPLEXITY enumerates LOW/MEDIUM/HIGH", () => {
    expect(COMPLEXITY).toEqual(["LOW", "MEDIUM", "HIGH"]);
  });
  it("a TaskGraphTask is well-formed", () => {
    const t: TaskGraphTask = {
      name: "Repo layer",
      complexity: "LOW",
      tdd: true,
      dependsOn: [],
      summary: "x",
      acceptanceCriteria: ["c1"],
    };
    expect(t.name).toBe("Repo layer");
  });
  it("composes TaskGraph, Epic, WorkflowTask, Dependency", () => {
    const graph: TaskGraph = { tasks: [] };
    const task: WorkflowTask = {
      id: "e__repo",
      title: "Repo layer",
      summary: "x",
      complexity: "LOW",
      tdd: true,
      acceptanceCriteria: ["c1"],
      status: "backlog",
    };
    const dep: Dependency = { taskId: "e__svc", dependsOnTaskId: "e__repo", type: "blocks" };
    const epic: Epic = { id: "e", title: "X", description: "", tasks: [task], dependencies: [dep] };
    expect(graph.tasks).toEqual([]);
    expect(epic.tasks[0].id).toBe("e__repo");
    expect(epic.dependencies[0].type).toBe("blocks");
  });
});
