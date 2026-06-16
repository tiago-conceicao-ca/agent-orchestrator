import { describe, it, expect } from "vitest";
import { makeGenerateBackendExecutor, type SpawnConfig, type SpawnFn } from "./generate-backend";
import { expandTaskPasses } from "../passes/expand";
import type { Epic, WorkflowTask, Dependency } from "../plan/types";
import type { PhaseContext, PrMode } from "../workflow/types";

function task(id: string, complexity: WorkflowTask["complexity"]): WorkflowTask {
  return { id, title: id, summary: "", complexity, tdd: false, acceptanceCriteria: ["c"], status: "backlog" };
}

/** Build an epic whose tasks are expanded into graduated lens passes. */
function epicWithPasses(tasks: WorkflowTask[], dependencies: Dependency[] = []): Epic {
  return { id: "epic-1", title: "X", description: "", tasks: expandTaskPasses(tasks, dependencies), dependencies };
}

function ctx(epic: Epic, prMode?: PrMode, taskStatus: Record<string, string> = {}) {
  const statuses: Record<string, string> = { ...taskStatus };
  return {
    statuses,
    ctx: {
      run: {
        id: "run-1", workflow: "w", epicId: "epic-1", status: "running" as const,
        currentPhaseIndex: 1, phaseStates: {}, taskStatus, verdicts: [], pendingApproval: null,
        createdAt: "2026-06-08T00:00:00Z", prMode,
      },
      epic,
      input: "",
      log: () => {},
      setTaskStatus: async (id: string, s: string) => { statuses[id] = s; },
      setTaskProgress: async () => {},
    } as PhaseContext,
  };
}

describe("generate-backend scheduler — graduated passes", () => {
  it("runs a task's passes SEQUENTIALLY sharing ONE worktree keyed by the task id", async () => {
    const spawns: SpawnConfig[] = [];
    const spawn: SpawnFn = async (cfg) => {
      spawns.push(cfg);
      return { id: `s-${spawns.length}`, workspacePath: `/wt/${cfg.worktreeKey}` };
    };
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone: async () => "done" });
    const epic = epicWithPasses([task("t", "HIGH")]); // 5 passes
    await exec.run(ctx(epic).ctx);

    expect(spawns).toHaveLength(5);
    // Every pass shares the SAME worktree key (the logical task id).
    expect(spawns.every((s) => s.worktreeKey === "t")).toBe(true);
    // Per-pass model tiers: initial=sonnet, reviews=opus.
    expect(spawns.map((s) => s.model)).toEqual(["sonnet", "opus", "opus", "opus", "opus"]);
    // The initial pass implements; review passes load their lens template.
    expect(spawns[0].prompt).toContain("gerar-backend");
    expect(spawns[1].prompt.toLowerCase()).toContain("correctness");
    expect(spawns[1].prompt).toContain("do NOT open another");
  });

  it("runs INDEPENDENT tasks in parallel, each in its OWN worktree, up to the cap", async () => {
    let live = 0;
    let maxLive = 0;
    const keysSeen = new Set<string>();
    const spawn: SpawnFn = async (cfg) => {
      live++;
      maxLive = Math.max(maxLive, live);
      keysSeen.add(cfg.worktreeKey ?? "none");
      return { id: `s-${cfg.sdlcTaskId}`, workspacePath: `/wt/${cfg.worktreeKey}` };
    };
    const waitForDone = async () => {
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return "done" as const;
    };
    // 3 independent tasks; cap 2 → at most 2 concurrent.
    const epic = epicWithPasses([task("a", "LOW"), task("b", "LOW"), task("c", "LOW")]);
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone, maxConcurrent: 2 });
    await exec.run(ctx(epic).ctx);

    expect(maxLive).toBe(2); // cap respected AND reached (genuine parallelism)
    expect(keysSeen).toEqual(new Set(["a", "b", "c"])); // each task its own worktree
  });

  it("respects a cap of 1 (fully serial across tasks)", async () => {
    let live = 0;
    let maxLive = 0;
    const spawn: SpawnFn = async () => {
      live++;
      maxLive = Math.max(maxLive, live);
      return { id: "s" };
    };
    const waitForDone = async () => {
      await new Promise((r) => setTimeout(r, 2));
      live--;
      return "done" as const;
    };
    const epic = epicWithPasses([task("a", "LOW"), task("b", "LOW")]);
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone, maxConcurrent: 1 });
    await exec.run(ctx(epic).ctx);
    expect(maxLive).toBe(1);
  });

  it("a downstream task's passes start only after its upstream task fully completes", async () => {
    const order: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      order.push(cfg.sdlcTaskId);
      return { id: `s-${order.length}`, workspacePath: `/wt/${cfg.worktreeKey}` };
    };
    const epic = epicWithPasses(
      [task("up", "LOW"), task("down", "LOW")],
      [{ taskId: "down", dependsOnTaskId: "up", type: "blocks" }],
    );
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone: async () => "done", maxConcurrent: 4 });
    await exec.run(ctx(epic).ctx);
    // All of up's passes precede every one of down's passes.
    const lastUp = order.lastIndexOf("up");
    const firstDown = order.indexOf("down");
    expect(firstDown).toBeGreaterThan(lastUp);
    expect(order.filter((x) => x === "up")).toHaveLength(3);
  });

  it("a failed task isolates its dependents while independent tasks still run", async () => {
    const spawnedTasks: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      spawnedTasks.push(cfg.sdlcTaskId);
      return { id: `s-${cfg.sdlcTaskId}-${spawnedTasks.length}` };
    };
    // 'a' fails; 'b' depends on 'a' (must be isolated); 'c' is independent (must run).
    const epic = epicWithPasses(
      [task("a", "LOW"), task("b", "LOW"), task("c", "LOW")],
      [{ taskId: "b", dependsOnTaskId: "a", type: "blocks" }],
    );
    const waitForDone = async (sessionId: string) =>
      sessionId.startsWith("s-a-") ? ("failed" as const) : ("done" as const);
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone, maxConcurrent: 4 });
    const { ctx: c, statuses } = ctx(epic);

    await expect(exec.run(c)).rejects.toThrow(/failed/i);
    expect(spawnedTasks).not.toContain("b"); // dependent isolated
    expect(spawnedTasks.filter((t) => t === "c")).toHaveLength(3); // independent ran all passes
    expect(statuses["a"]).toBe("blocked");
    expect(statuses["b"]).toBeUndefined(); // never started
  });

  it("skips tasks already done (resume) and still unblocks their dependents", async () => {
    const spawnedTasks: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      spawnedTasks.push(cfg.sdlcTaskId);
      return { id: `s-${spawnedTasks.length}`, workspacePath: `/wt/${cfg.worktreeKey}` };
    };
    const epic = epicWithPasses(
      [task("up", "LOW"), task("down", "LOW")],
      [{ taskId: "down", dependsOnTaskId: "up", type: "blocks" }],
    );
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone: async () => "done" });
    await exec.run(ctx(epic, undefined, { up: "done" }).ctx);
    // up skipped; down still runs all its passes.
    expect(spawnedTasks.every((t) => t === "down")).toBe(true);
    expect(spawnedTasks).toHaveLength(3);
  });

  it("rejects a dependency cycle before scheduling", async () => {
    const epic = epicWithPasses(
      [task("a", "LOW"), task("b", "LOW")],
      [
        { taskId: "a", dependsOnTaskId: "b", type: "blocks" },
        { taskId: "b", dependsOnTaskId: "a", type: "blocks" },
      ],
    );
    const exec = makeGenerateBackendExecutor({ spawn: async () => ({ id: "s" }), projectId: "b", waitForDone: async () => "done" });
    await expect(exec.run(ctx(epic).ctx)).rejects.toThrow(/cycle/i);
  });
});
