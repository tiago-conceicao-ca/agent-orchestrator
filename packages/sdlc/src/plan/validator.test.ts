import { describe, it, expect } from "vitest";
import { validateTaskGraph } from "./validator";
import type { TaskGraph } from "./types";

const ok: TaskGraph = {
  tasks: [
    { name: "A", complexity: "LOW", tdd: true, dependsOn: [], summary: "", acceptanceCriteria: [] },
    { name: "B", complexity: "LOW", tdd: true, dependsOn: ["A"], summary: "", acceptanceCriteria: [] },
  ],
};

describe("validateTaskGraph", () => {
  it("passes a clean graph", () => {
    const r = validateTaskGraph(ok, ["A", "B"]);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });
  it("flags duplicate task names", () => {
    const g: TaskGraph = { tasks: [ok.tasks[0], ok.tasks[0]] };
    const r = validateTaskGraph(g, ["A"]);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === "DUPLICATE_NAME")).toBe(true);
  });
  it("flags unresolved dependency", () => {
    const g: TaskGraph = { tasks: [{ ...ok.tasks[1], dependsOn: ["GHOST"] }] };
    const r = validateTaskGraph(g, ["B"]);
    expect(r.issues.some((i) => i.code === "UNRESOLVED_DEPENDENCY")).toBe(true);
  });
  it("detects a cycle", () => {
    const g: TaskGraph = {
      tasks: [
        { ...ok.tasks[0], dependsOn: ["B"] },
        { ...ok.tasks[1], dependsOn: ["A"] },
      ],
    };
    const r = validateTaskGraph(g, ["A", "B"]);
    expect(r.issues.some((i) => i.code === "CYCLE_DETECTED")).toBe(true);
  });
  it("does not emit a spurious cycle when task names are duplicated", () => {
    const g: TaskGraph = {
      tasks: [
        { name: "A", complexity: "LOW", tdd: true, dependsOn: ["B"], summary: "", acceptanceCriteria: [] },
        { name: "A", complexity: "LOW", tdd: true, dependsOn: ["B"], summary: "", acceptanceCriteria: [] },
        { name: "B", complexity: "LOW", tdd: true, dependsOn: [], summary: "", acceptanceCriteria: [] },
      ],
    };
    const r = validateTaskGraph(g, ["A", "B"]);
    expect(r.issues.some((i) => i.code === "DUPLICATE_NAME")).toBe(true);
    expect(r.issues.some((i) => i.code === "CYCLE_DETECTED")).toBe(false);
  });
  it("flags a task with no matching ## Task section", () => {
    const r = validateTaskGraph(ok, ["A"]); // B has no section
    expect(r.issues.some((i) => i.code === "MISSING_TASK_SECTION" && i.message.includes("B"))).toBe(
      true,
    );
  });
});
