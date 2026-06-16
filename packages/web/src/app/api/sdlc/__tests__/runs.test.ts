import { describe, it, expect } from "vitest";
import {
  assignTaskNumbers,
  availableRunActions,
  dependsOnTitles,
  filterRunsByProject,
  isAbandoned,
  lastErrorFromRun,
  planArtifactFromRun,
  taskTotals,
  titlesFromRun,
  toKanban,
  toPhaseStates,
  toVerdictViews,
  verdictSummary,
  type Board,
  type RunView,
  type VerdictView,
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

describe("isAbandoned", () => {
  function runWith(status: string, message?: string): RunView {
    const run = makeRunView("run-x", "alpha");
    return { ...run, status, lastError: message ? { phase: "abandon", message } : null };
  }

  it("recognizes a run with the abandoned status", () => {
    expect(isAbandoned(runWith("abandoned"))).toBe(true);
  });

  it("recognizes a legacy run abandoned under the old code (failed + 'Run abandoned.')", () => {
    expect(isAbandoned(runWith("failed", "Run abandoned."))).toBe(true);
  });

  it("recognizes a reconciled run (failed + dead-engine message)", () => {
    expect(isAbandoned(runWith("failed", "Engine process 12345 is no longer alive."))).toBe(true);
  });

  it("does not treat a genuine non-abandon failure as abandoned", () => {
    expect(isAbandoned(runWith("failed", "Lens gate rejected the plan."))).toBe(false);
    expect(isAbandoned(runWith("failed"))).toBe(false);
  });

  it("does not treat running/awaiting/completed runs as abandoned", () => {
    expect(isAbandoned(runWith("running"))).toBe(false);
    expect(isAbandoned(runWith("awaiting_approval"))).toBe(false);
    expect(isAbandoned(runWith("completed"))).toBe(false);
  });
});

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

describe("availableRunActions", () => {
  it("gates an awaiting run with approve + abandon", () => {
    expect(availableRunActions("awaiting_approval")).toEqual(["approve", "abandon"]);
  });
  it("offers abandon while running", () => {
    expect(availableRunActions("running")).toEqual(["abandon"]);
  });
  it("offers resume + abandon for a failed run", () => {
    expect(availableRunActions("failed")).toEqual(["resume", "abandon"]);
  });
  it("offers abandon for a completed run (to dismiss it)", () => {
    expect(availableRunActions("completed")).toEqual(["abandon"]);
  });
  it("offers no run-level actions for an already-abandoned run", () => {
    expect(availableRunActions("abandoned")).toEqual([]);
  });
});

describe("verdictSummary", () => {
  it("counts passes and needs-fixes and tracks the latest failing verdict", () => {
    const verdicts: VerdictView[] = [
      { lens: "tactical", verdict: "pass", issues: [], rawOutput: null },
      { lens: "pattern-library", verdict: "needs_fixes", issues: [], rawOutput: null },
      { lens: "tactical", verdict: "needs_fixes", issues: [], rawOutput: "second fail" },
    ];
    const summary = verdictSummary(verdicts);
    expect(summary.passed).toBe(1);
    expect(summary.needsFixes).toBe(2);
    expect(summary.latestNeedsFixes?.rawOutput).toBe("second fail");
  });
  it("returns zeros and null for no verdicts", () => {
    expect(verdictSummary([])).toEqual({ passed: 0, needsFixes: 0, latestNeedsFixes: null });
  });
});

describe("taskTotals", () => {
  it("sums total and per-bucket counts", () => {
    const board: Board = {
      backlog: [{ number: 1, taskId: "a", title: "A", status: "backlog" }],
      ready: [],
      in_progress: [{ number: 2, taskId: "b", title: "B", status: "in_progress" }],
      in_review: [],
      done: [{ number: 3, taskId: "c", title: "C", status: "done" }],
      blocked: [{ number: 4, taskId: "d", title: "D", status: "blocked" }],
    };
    expect(taskTotals(board)).toEqual({ total: 4, done: 1, inProgress: 1, blocked: 1 });
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
