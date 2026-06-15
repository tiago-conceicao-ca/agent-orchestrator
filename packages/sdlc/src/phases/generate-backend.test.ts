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

function ctx(prMode?: PrMode): { ctx: PhaseContext; statuses: Record<string, string> } {
  const statuses: Record<string, string> = {};
  return {
    statuses,
    ctx: {
      run: {
        id: "run-1",
        workflow: "w",
        epicId: "epic-1",
        status: "running",
        currentPhaseIndex: 1,
        phaseStates: {},
        taskStatus: {},
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
});
