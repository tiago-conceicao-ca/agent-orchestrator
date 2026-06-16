import { describe, it, expect } from "vitest";
import { expandTaskPasses, passId } from "./expand";
import type { Dependency, WorkflowTask } from "../plan/types";

function task(id: string, complexity: WorkflowTask["complexity"]): WorkflowTask {
  return {
    id,
    title: id,
    summary: "",
    complexity,
    tdd: false,
    acceptanceCriteria: ["c"],
    status: "backlog",
  };
}

describe("expandTaskPasses", () => {
  it("expands a HIGH task to 5 chained passes", () => {
    const [t] = expandTaskPasses([task("t", "HIGH")], []);
    const passes = t.passes!;
    expect(passes.map((p) => p.role)).toEqual([
      "initial",
      "correctness",
      "edge_cases",
      "simplicity",
      "excellence",
    ]);
    // Each review pass waits for the previous pass and references initial.
    expect(passes[0].waitsFor).toEqual([]);
    expect(passes[1].waitsFor).toEqual([passId("t", "initial")]);
    expect(passes[1].previousPassId).toBe(passId("t", "initial"));
    expect(passes[1].initialPassId).toBe(passId("t", "initial"));
    expect(passes[4].previousPassId).toBe(passId("t", "simplicity"));
  });

  it("expands a LOW task to 3 chained passes", () => {
    const [t] = expandTaskPasses([task("t", "LOW")], []);
    expect(t.passes!.map((p) => p.role)).toEqual(["initial", "correctness", "edge_cases"]);
  });

  it("wires cross-task deps to the upstream task's TERMINAL pass", () => {
    const tasks = [task("up", "LOW"), task("down", "MEDIUM")];
    const deps: Dependency[] = [{ taskId: "down", dependsOnTaskId: "up", type: "blocks" }];
    const [, down] = expandTaskPasses(tasks, deps);
    // down's initial pass waits for up's LAST pass (edge_cases for a LOW task),
    // not up's initial pass.
    expect(down.passes![0].waitsFor).toEqual([passId("up", "edge_cases")]);
  });

  it("the initial pass of a task with no deps waits for nothing", () => {
    const [t] = expandTaskPasses([task("t", "MEDIUM")], []);
    expect(t.passes![0].waitsFor).toEqual([]);
  });

  it("carries per-pass model tiers (initial=sonnet, reviews=opus)", () => {
    const [t] = expandTaskPasses([task("t", "HIGH")], []);
    expect(t.passes![0].model).toBe("sonnet");
    expect(t.passes!.slice(1).every((p) => p.model === "opus")).toBe(true);
  });

  it("does not mutate the input tasks", () => {
    const input = task("t", "LOW");
    expandTaskPasses([input], []);
    expect(input.passes).toBeUndefined();
  });
});
