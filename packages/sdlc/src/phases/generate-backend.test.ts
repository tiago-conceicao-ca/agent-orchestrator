import { describe, it, expect } from "vitest";
import {
  makeGenerateBackendExecutor,
  sharedEpicBranch,
  type SpawnFn,
} from "./generate-backend";
import type { Epic } from "../plan/types";
import type { PhaseContext, PrMode } from "../workflow/types";

const epic: Epic = {
  id: "epic-1",
  title: "X",
  description: "",
  tasks: [
    { id: "t-repo", title: "Repo", summary: "", complexity: "LOW", tdd: true, acceptanceCriteria: ["c"], status: "backlog" },
    { id: "t-svc", title: "Svc", summary: "", complexity: "LOW", tdd: true, acceptanceCriteria: ["c"], status: "backlog" },
  ],
  dependencies: [{ taskId: "t-svc", dependsOnTaskId: "t-repo", type: "blocks" }],
};

function ctx(
  prMode?: PrMode,
  taskStatus: Record<string, string> = {},
): {
  ctx: PhaseContext;
  statuses: Record<string, string>;
  progress: Record<string, { attempts: number; stalled: boolean }>;
} {
  const statuses: Record<string, string> = { ...taskStatus };
  const progress: Record<string, { attempts: number; stalled: boolean }> = {};
  return {
    statuses,
    progress,
    ctx: {
      run: {
        id: "run-1",
        workflow: "w",
        epicId: "epic-1",
        status: "running",
        currentPhaseIndex: 1,
        phaseStates: {},
        taskStatus,
        verdicts: [],
        pendingApproval: null,
        createdAt: "2026-06-08T00:00:00Z",
        prMode,
      },
      epic,
      input: "",
      log: () => {},
      setTaskStatus: async (id, s) => {
        statuses[id] = s;
      },
      setTaskProgress: async (id, p) => {
        progress[id] = p;
      },
    },
  };
}

describe("generate-backend executor", () => {
  it("spawns one session per task in dependency order with SDLC metadata", async () => {
    const spawned: { taskId: string; prompt: string; meta: Record<string, string> }[] = [];
    const spawn: SpawnFn = async (cfg) => {
      spawned.push({ taskId: cfg.sdlcTaskId, prompt: cfg.prompt, meta: cfg.metadata });
      return { id: `sess-${spawned.length}` };
    };
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "backend", waitForDone: async () => "done" });
    const { ctx: c, statuses } = ctx();
    const result = await exec.run(c);
    expect(spawned.map((s) => s.taskId)).toEqual(["t-repo", "t-svc"]); // topo order
    expect(spawned[0].prompt).toContain("gerar-backend");
    expect(spawned[0].meta.sdlcRunId).toBe("run-1");
    expect(statuses["t-repo"]).toBe("done");
    expect(result.artifactRef).toContain("epic-1");
  });

  it("passes each task's model to the spawn call", async () => {
    const epicWithModels: Epic = {
      ...epic,
      tasks: [
        { ...epic.tasks[0], model: "haiku" },
        { ...epic.tasks[1], model: "opus" },
      ],
    };
    const models: (string | undefined)[] = [];
    const spawn: SpawnFn = async (cfg) => {
      models.push(cfg.model);
      return { id: `s-${models.length}` };
    };
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone: async () => "done" });
    const { ctx: c } = ctx();
    await exec.run({ ...c, epic: epicWithModels });
    expect(models).toEqual(["haiku", "opus"]); // topo order, each task's own model
  });

  it("passes undefined model when the task has none (byte-identical to today)", async () => {
    const models: (string | undefined)[] = [];
    const spawn: SpawnFn = async (cfg) => {
      models.push(cfg.model);
      return { id: `s-${models.length}` };
    };
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone: async () => "done" });
    const { ctx: c } = ctx();
    await exec.run(c);
    expect(models).toEqual([undefined, undefined]);
  });

  it("throws if a task's dependency failed", async () => {
    const spawn: SpawnFn = async () => ({ id: "s" });
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "backend", waitForDone: async () => "failed" });
    const { ctx: c } = ctx();
    await expect(exec.run(c)).rejects.toThrow(/failed/i);
  });

  it("uses an injected buildTaskPrompt when provided (default stays /gerar-backend)", async () => {
    const prompts: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      prompts.push(cfg.prompt);
      return { id: "s" };
    };
    const exec = makeGenerateBackendExecutor({
      spawn,
      projectId: "backend",
      waitForDone: async () => "done",
      buildTaskPrompt: (t) => `NODE: implement ${t.title} as plain Node.js`,
    });
    const { ctx: c } = ctx();
    await exec.run(c);
    expect(prompts[0]).toBe("NODE: implement Repo as plain Node.js");
    expect(prompts.join("\n")).not.toContain("gerar-backend");
  });

  it("per-task mode (default): tells each worker to open its own PR + write the sentinel", async () => {
    const prompts: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      prompts.push(cfg.prompt);
      return { id: "s" };
    };
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone: async () => "done" });
    const { ctx: c } = ctx("per-task");
    await exec.run(c);
    expect(prompts[0]).toContain("When done, open a PR.");
    expect(prompts[0]).toContain("sdlc-task-done.json");
    expect(prompts[0]).not.toContain("shared epic branch");
  });

  it("shared mode: tells workers to push the shared epic branch and NOT open a PR", async () => {
    const prompts: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      prompts.push(cfg.prompt);
      return { id: "s" };
    };
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone: async () => "done" });
    const { ctx: c } = ctx("shared");
    await exec.run(c);
    expect(prompts[0]).toContain(sharedEpicBranch("epic-1"));
    expect(prompts[0]).toContain("Do NOT open your");
    expect(prompts[0]).toContain("sdlc-task-done.json");
  });

  it("shared mode completes a non-PR worker via the sentinel (fake session manager)", async () => {
    // The completion seam never sees a PR; waitForDone returns done only because
    // the worker wrote the sentinel. This is the shared-PR stall fix in miniature.
    const seen: string[] = [];
    const waitForDone = async (sessionId: string, workspacePath?: string) => {
      seen.push(`${sessionId}:${workspacePath ?? "none"}`);
      return "done" as const;
    };
    const spawn: SpawnFn = async (cfg) => ({ id: `s-${cfg.sdlcTaskId}`, workspacePath: `/wt/${cfg.sdlcTaskId}` });
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone });
    const { ctx: c, statuses } = ctx("shared");
    await exec.run(c);
    expect(statuses["t-repo"]).toBe("done");
    expect(statuses["t-svc"]).toBe("done");
    expect(seen[0]).toBe("s-t-repo:/wt/t-repo"); // workspacePath threaded for the sentinel
  });

  it("returns the spawned worktree path(s) as artifactRef when provided", async () => {
    const spawn: SpawnFn = async (cfg) => ({ id: "s", workspacePath: `/wt/${cfg.sdlcTaskId}` });
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "backend", waitForDone: async () => "done" });
    const { ctx: c } = ctx();
    const result = await exec.run(c);
    expect(result.artifactRef).toContain("/wt/t-repo");
    expect(result.artifactRef).toContain("/wt/t-svc");
  });

  it("auto-retries a stalled task once, then succeeds (records attempts)", async () => {
    const spawns: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      spawns.push(cfg.sdlcTaskId);
      return { id: `s-${spawns.length}` };
    };
    // t-repo stalls on its first wait, succeeds on the retry; t-svc is fine.
    const outcomes = new Map<string, ("stalled" | "done")[]>([
      ["s-1", ["stalled"]],
      ["s-2", ["done"]], // t-repo retry
      ["s-3", ["done"]], // t-svc
    ]);
    const waitForDone = async (sessionId: string) => outcomes.get(sessionId)!.shift()!;
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone });
    const { ctx: c, statuses, progress } = ctx();
    await exec.run(c);
    expect(spawns).toEqual(["t-repo", "t-repo", "t-svc"]); // one auto-retry of t-repo
    expect(statuses["t-repo"]).toBe("done");
    expect(progress["t-repo"]).toEqual({ attempts: 2, stalled: false });
  });

  it("fails the run when a task stalls again after its single auto-retry", async () => {
    const spawns: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      spawns.push(cfg.sdlcTaskId);
      return { id: "s" };
    };
    const exec = makeGenerateBackendExecutor({
      spawn,
      projectId: "b",
      waitForDone: async () => "stalled",
    });
    const { ctx: c, statuses, progress } = ctx();
    await expect(exec.run(c)).rejects.toThrow(/stalled after auto-retry/i);
    expect(spawns).toEqual(["t-repo", "t-repo"]); // initial + one retry, then give up
    expect(statuses["t-repo"]).toBe("blocked");
    expect(progress["t-repo"]).toEqual({ attempts: 2, stalled: true });
  });

  it("does NOT retry a hard failure (preserves existing fail-fast behavior)", async () => {
    const spawns: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      spawns.push(cfg.sdlcTaskId);
      return { id: "s" };
    };
    const exec = makeGenerateBackendExecutor({
      spawn,
      projectId: "b",
      waitForDone: async () => "failed",
    });
    const { ctx: c } = ctx();
    await expect(exec.run(c)).rejects.toThrow(/failed during backend generation/i);
    expect(spawns).toEqual(["t-repo"]); // no retry on hard failure
  });

  it("skips tasks already marked done (resume)", async () => {
    const spawns: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      spawns.push(cfg.sdlcTaskId);
      return { id: "s" };
    };
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone: async () => "done" });
    const { ctx: c } = ctx(undefined, { "t-repo": "done" });
    await exec.run(c);
    expect(spawns).toEqual(["t-svc"]); // t-repo skipped
  });

  it("runTask re-runs a single task (retry) reusing the epic", async () => {
    const spawns: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      spawns.push(cfg.sdlcTaskId);
      return { id: "s" };
    };
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone: async () => "done" });
    const { ctx: c, statuses } = ctx();
    await exec.runTask!(c, "t-svc");
    expect(spawns).toEqual(["t-svc"]); // only the requested task
    expect(statuses["t-svc"]).toBe("done");
  });
});
