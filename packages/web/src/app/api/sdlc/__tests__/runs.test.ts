import { describe, it, expect } from "vitest";
import { titlesFromRun, toKanban } from "@/lib/sdlc-board";
import type { WorkflowRun } from "@aoagents/ao-sdlc";

describe("toKanban", () => {
  it("groups a run's tasks by status into columns", () => {
    const run = {
      id: "run-1",
      taskStatus: { "t-a": "done", "t-b": "in_progress", "t-c": "backlog" },
    } as unknown as WorkflowRun;
    const board = toKanban(run, { "t-a": "Repo", "t-b": "Svc", "t-c": "API" });
    expect(board.done.map((c) => c.title)).toEqual(["Repo"]);
    expect(board.in_progress.map((c) => c.title)).toEqual(["Svc"]);
    expect(board.backlog.map((c) => c.title)).toEqual(["API"]);
  });

  it("falls back to the task id when no title is provided", () => {
    const run = { id: "r", taskStatus: { "epic__x": "blocked" } } as unknown as WorkflowRun;
    const board = toKanban(run, {});
    expect(board.blocked).toEqual([{ taskId: "epic__x", title: "epic__x", status: "blocked" }]);
  });

  it("derives card titles from the run's persisted epic", () => {
    const run = {
      id: "r",
      taskStatus: { "epic-1__repo": "done" },
      epic: {
        id: "epic-1",
        title: "X",
        description: "",
        tasks: [
          {
            id: "epic-1__repo",
            title: "Repo layer",
            summary: "",
            complexity: "LOW",
            tdd: true,
            acceptanceCriteria: [],
            status: "done",
          },
        ],
        dependencies: [],
      },
    } as unknown as WorkflowRun;
    expect(titlesFromRun(run)).toEqual({ "epic-1__repo": "Repo layer" });
    const board = toKanban(run, titlesFromRun(run));
    expect(board.done).toEqual([{ taskId: "epic-1__repo", title: "Repo layer", status: "done" }]);
  });

  it("ignores unknown statuses", () => {
    const run = { id: "r", taskStatus: { "t": "weird" } } as unknown as WorkflowRun;
    const board = toKanban(run, {});
    const total = Object.values(board).reduce((n, col) => n + col.length, 0);
    expect(total).toBe(0);
  });
});
