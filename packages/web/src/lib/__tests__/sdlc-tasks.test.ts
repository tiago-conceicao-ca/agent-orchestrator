import { describe, it, expect } from "vitest";
import type { WorkflowRun } from "@contaazul/cahi-sdlc";
import { enrichRunTasks } from "@/lib/sdlc-tasks";

function runWith(model: string | undefined): WorkflowRun {
  return {
    id: "run-1",
    workflow: "w",
    epicId: "epic-1",
    status: "running",
    currentPhaseIndex: 0,
    phaseStates: {},
    taskStatus: {},
    verdicts: [],
    pendingApproval: null,
    createdAt: "2026-06-09T00:00:00Z",
    epic: {
      id: "epic-1",
      title: "X",
      description: "",
      tasks: [
        {
          id: "t-1",
          title: "T1",
          summary: "",
          complexity: "LOW",
          tdd: false,
          acceptanceCriteria: [],
          status: "backlog",
          ...(model !== undefined ? { model } : {}),
        },
      ],
      dependencies: [],
    },
  };
}

describe("enrichRunTasks — model source", () => {
  it("prefers the epic task's model (assigned pre-dispatch)", () => {
    const tasks = enrichRunTasks(runWith("opus"), new Map());
    expect(tasks[0].model).toBe("opus");
  });

  it("falls back to the linked session's recorded model when the task has none", () => {
    const linked = new Map([
      [
        "t-1",
        {
          link: { sessionId: "s-1", projectId: "p", projectSessionPath: "/p/s-1" },
          agent: "claude-code",
          model: "sonnet",
        },
      ],
    ]);
    const tasks = enrichRunTasks(runWith(undefined), linked);
    expect(tasks[0].model).toBe("sonnet");
  });

  it("is null when neither the task nor a linked session has a model", () => {
    const tasks = enrichRunTasks(runWith(undefined), new Map());
    expect(tasks[0].model).toBeNull();
  });
});
