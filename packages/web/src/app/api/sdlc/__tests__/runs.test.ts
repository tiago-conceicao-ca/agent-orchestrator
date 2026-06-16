import { describe, it, expect } from "vitest";
import {
  assignTaskNumbers,
  dependsOnTitles,
  filterRunsByProject,
  lastErrorFromRun,
  planArtifactFromRun,
  titlesFromRun,
  toKanban,
  toPhaseStates,
  toVerdictViews,
  type RunView,
} from "@/lib/sdlc-board";
import type { WorkflowRun } from "@aoagents/ao-sdlc";

function makeRunView(id: string, projectId: string): RunView {
  return {
    id,
    projectId,
    workflow: "ca-plan-to-backend",
    status: "running",
    pendingApproval: undefined,
    createdAt: "2026-06-09T00:00:00Z",
    board: { backlog: [], ready: [], in_progress: [], in_review: [], done: [], blocked: [] },
    tasks: [],
    phaseStates: [],
    verdicts: [],
    planArtifact: null,
    lastError: null,
    prMode: "per-task",
  };
}

describe("filterRunsByProject", () => {
  const runs = [makeRunView("run-a", "alpha"), makeRunView("run-b", "beta")];

  it("scopes runs to the given project", () => {
    expect(filterRunsByProject(runs, "alpha").map((r) => r.id)).toEqual(["run-a"]);
  });

  it("returns every run for the all-projects view (undefined projectId)", () => {
    expect(filterRunsByProject(runs, undefined).map((r) => r.id)).toEqual(["run-a", "run-b"]);
  });

  it("returns an empty list when no run matches the project", () => {
    expect(filterRunsByProject(runs, "gamma")).toEqual([]);
  });
});

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
    expect(board.blocked).toEqual([
      { number: 1, taskId: "epic__x", title: "epic__x", status: "blocked" },
    ]);
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
    expect(board.done).toEqual([
      { number: 1, taskId: "epic-1__repo", title: "Repo layer", status: "done" },
    ]);
  });

  it("ignores unknown statuses", () => {
    const run = { id: "r", taskStatus: { "t": "weird" } } as unknown as WorkflowRun;
    const board = toKanban(run, {});
    const total = Object.values(board).reduce((n, col) => n + col.length, 0);
    expect(total).toBe(0);
  });

  it("numbers cards (T1..Tn) by the epic's task order, not status grouping", () => {
    const run = {
      id: "r",
      taskStatus: { a: "done", b: "in_progress", c: "backlog" },
      epic: {
        id: "e",
        title: "",
        description: "",
        tasks: [
          { id: "a", title: "A", summary: "", complexity: "LOW", tdd: false, acceptanceCriteria: [], status: "done" },
          { id: "b", title: "B", summary: "", complexity: "LOW", tdd: false, acceptanceCriteria: [], status: "in_progress" },
          { id: "c", title: "C", summary: "", complexity: "LOW", tdd: false, acceptanceCriteria: [], status: "backlog" },
        ],
        dependencies: [],
      },
    } as unknown as WorkflowRun;
    const board = toKanban(run, titlesFromRun(run));
    expect(board.done[0].number).toBe(1);
    expect(board.in_progress[0].number).toBe(2);
    expect(board.backlog[0].number).toBe(3);
  });
});

describe("assignTaskNumbers", () => {
  it("assigns 1-based T-numbers in the epic's task order", () => {
    const run = {
      id: "r",
      taskStatus: { "e__c": "backlog", "e__a": "done", "e__b": "ready" },
      epic: {
        id: "e",
        title: "",
        description: "",
        tasks: [
          { id: "e__a", title: "A", summary: "", complexity: "LOW", tdd: false, acceptanceCriteria: [], status: "done" },
          { id: "e__b", title: "B", summary: "", complexity: "LOW", tdd: false, acceptanceCriteria: [], status: "ready" },
          { id: "e__c", title: "C", summary: "", complexity: "LOW", tdd: false, acceptanceCriteria: [], status: "backlog" },
        ],
        dependencies: [],
      },
    } as unknown as WorkflowRun;
    expect(assignTaskNumbers(run)).toEqual({ "e__a": 1, "e__b": 2, "e__c": 3 });
  });

  it("falls back to taskStatus insertion order when there is no epic yet", () => {
    const run = { id: "r", taskStatus: { x: "backlog", y: "backlog" } } as unknown as WorkflowRun;
    expect(assignTaskNumbers(run)).toEqual({ x: 1, y: 2 });
  });
});

describe("toPhaseStates", () => {
  it("maps the phaseStates record to an ordered id/state view", () => {
    const run = {
      id: "r",
      taskStatus: {},
      phaseStates: { "normalize-plan": "passed", "generate-backend": "running" },
    } as unknown as WorkflowRun;
    expect(toPhaseStates(run)).toEqual([
      { id: "normalize-plan", state: "passed" },
      { id: "generate-backend", state: "running" },
    ]);
  });

  it("returns an empty list when no phases have run yet", () => {
    const run = { id: "r", taskStatus: {}, phaseStates: {} } as unknown as WorkflowRun;
    expect(toPhaseStates(run)).toEqual([]);
  });
});

describe("toVerdictViews", () => {
  it("maps verdicts to the slim view with issues and captured output", () => {
    const run = {
      id: "r",
      taskStatus: {},
      verdicts: [
        {
          type: "gate",
          lens: "tactical",
          verdict: "needs_fixes",
          issues: [{ severity: "high", title: "Missing tests", detail: "Add unit tests." }],
          rawOutput: "Reasoning...\n{\"verdict\":\"needs_fixes\"}",
        },
        { type: "gate", lens: "architectural", verdict: "pass", issues: [] },
      ],
    } as unknown as WorkflowRun;
    const views = toVerdictViews(run);
    expect(views).toHaveLength(2);
    expect(views[0]).toEqual({
      lens: "tactical",
      verdict: "needs_fixes",
      issues: [{ severity: "high", title: "Missing tests", detail: "Add unit tests." }],
      rawOutput: "Reasoning...\n{\"verdict\":\"needs_fixes\"}",
    });
    // A verdict without captured output maps rawOutput to null.
    expect(views[1].rawOutput).toBeNull();
    expect(views[1].issues).toEqual([]);
  });

  it("returns an empty list when there are no verdicts", () => {
    const run = { id: "r", taskStatus: {}, verdicts: [] } as unknown as WorkflowRun;
    expect(toVerdictViews(run)).toEqual([]);
  });
});

describe("planArtifactFromRun", () => {
  it("returns the persisted plan markdown", () => {
    const run = { id: "r", taskStatus: {}, planMarkdown: "# Plan" } as unknown as WorkflowRun;
    expect(planArtifactFromRun(run)).toBe("# Plan");
  });

  it("returns null when no plan artifact is persisted", () => {
    const run = { id: "r", taskStatus: {} } as unknown as WorkflowRun;
    expect(planArtifactFromRun(run)).toBeNull();
  });
});

describe("lastErrorFromRun", () => {
  it("returns the persisted lastError when present", () => {
    const run = {
      id: "r",
      taskStatus: {},
      lastError: { phase: "normalize-plan", message: "Lens 'tactical' rejected: Missing tests" },
    } as unknown as WorkflowRun;
    expect(lastErrorFromRun(run)).toEqual({
      phase: "normalize-plan",
      message: "Lens 'tactical' rejected: Missing tests",
    });
  });

  it("returns null when no error is recorded", () => {
    const run = { id: "r", taskStatus: {} } as unknown as WorkflowRun;
    expect(lastErrorFromRun(run)).toBeNull();
  });
});

describe("dependsOnTitles", () => {
  const run = {
    id: "r",
    taskStatus: {},
    epic: {
      id: "e",
      title: "",
      description: "",
      tasks: [
        { id: "e__mig", title: "Migration V21", summary: "", complexity: "LOW", tdd: true, acceptanceCriteria: [], status: "backlog" },
        { id: "e__ent", title: "Entity", summary: "", complexity: "LOW", tdd: true, acceptanceCriteria: [], status: "backlog" },
      ],
      dependencies: [{ taskId: "e__ent", dependsOnTaskId: "e__mig", type: "blocks" }],
    },
  } as unknown as WorkflowRun;

  it("resolves a task's blocking dependencies to their titles", () => {
    expect(dependsOnTitles(run, "e__ent")).toEqual(["Migration V21"]);
  });

  it("returns an empty list for a task with no dependencies", () => {
    expect(dependsOnTitles(run, "e__mig")).toEqual([]);
  });
});
