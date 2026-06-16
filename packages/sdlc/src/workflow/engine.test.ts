import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkflowEngine } from "./engine";
import { RunStore } from "./run-store";
import type { WorkflowDefinition, PhaseExecutor } from "./types";
import type { Gate } from "../gates/types";

const passGate: Gate = {
  name: "tactical",
  evaluate: async () => ({ type: "gate", lens: "tactical", issues: [], verdict: "pass" }),
};
const failGate: Gate = {
  name: "tactical",
  evaluate: async () => ({
    type: "gate",
    lens: "tactical",
    issues: [{ severity: "high", title: "x", detail: "y" }],
    verdict: "needs_fixes",
  }),
};
const throwGate: Gate = {
  name: "tactical",
  evaluate: async () => {
    throw new Error("gate boom");
  },
};
const exec = (id: string): PhaseExecutor => ({ id, run: async () => ({ artifactRef: `art-${id}` }) });

function makeEngine(dir: string, def: WorkflowDefinition, gates: Gate[]) {
  return new WorkflowEngine({
    store: new RunStore(dir),
    definitions: { [def.name]: def },
    executors: Object.fromEntries(def.phases.map((p) => [p.executor, exec(p.executor)])),
    gates: Object.fromEntries(gates.map((g) => [g.name, g])),
  });
}

describe("WorkflowEngine", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "eng-"));
  });

  it("runs all phases to completion when gates pass and no human gate", async () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [
        { id: "p1", executor: "p1", gates: ["tactical"], humanGate: false },
        { id: "p2", executor: "p2", gates: [], humanGate: false },
      ],
    };
    const eng = makeEngine(dir, def, [passGate]);
    const run = await eng.start("w", "epic-1", "input");
    const final = await eng.load(run.id);
    expect(final?.status).toBe("completed");
    expect(final?.currentPhaseIndex).toBe(2);
  });

  it("pauses at a human gate as awaiting_approval, then resume() finishes", async () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [
        { id: "p1", executor: "p1", gates: [], humanGate: true },
        { id: "p2", executor: "p2", gates: [], humanGate: false },
      ],
    };
    const eng = makeEngine(dir, def, []);
    const run = await eng.start("w", "epic-1", "input");
    let s = await eng.load(run.id);
    expect(s?.status).toBe("awaiting_approval");
    expect(s?.pendingApproval?.phaseId).toBe("p1");
    await eng.resume(run.id);
    s = await eng.load(run.id);
    expect(s?.status).toBe("completed");
  });

  it("defaults prMode to per-task and persists an explicit shared prMode", async () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [{ id: "p1", executor: "p1", gates: [], humanGate: false }],
    };
    const eng = makeEngine(dir, def, []);
    const a = await eng.start("w", "epic-1", "input");
    expect((await eng.load(a.id))?.prMode).toBe("per-task");
    const b = await eng.start("w", "epic-2", "input", { prMode: "shared" });
    expect((await eng.load(b.id))?.prMode).toBe("shared");
  });

  it("marks the run failed when a gate returns needs_fixes and surfaces lastError", async () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [{ id: "p1", executor: "p1", gates: ["tactical"], humanGate: false }],
    };
    const eng = makeEngine(dir, def, [failGate]);
    const run = await eng.start("w", "epic-1", "input");
    const s = await eng.load(run.id);
    expect(s?.status).toBe("failed");
    expect(s?.verdicts[0].verdict).toBe("needs_fixes");
    expect(s?.lastError?.phase).toBe("p1");
    expect(s?.lastError?.message).toMatch(/tactical/);
  });

  it("records lastError when an executor throws (no silent failure)", async () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [{ id: "p1", executor: "p1", gates: [], humanGate: false }],
    };
    const boomExec: PhaseExecutor = {
      id: "p1",
      run: async () => {
        throw new Error("executor boom");
      },
    };
    const eng = new WorkflowEngine({
      store: new RunStore(dir),
      definitions: { w: def },
      executors: { p1: boomExec },
      gates: {},
    });
    await expect(eng.start("w", "epic-1", "input")).rejects.toThrow(/executor boom/);
    const runs = await new RunStore(dir).list();
    expect(runs[0].status).toBe("failed");
    expect(runs[0].lastError).toEqual({ phase: "p1", message: "executor boom" });
  });

  it("gives each run a unique id so re-running the same plan does not overwrite", async () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [{ id: "p1", executor: "p1", gates: [], humanGate: false }],
    };
    const eng = makeEngine(dir, def, []);
    const a = await eng.start("w", "epic-1", "input");
    const b = await eng.start("w", "epic-1", "input");
    expect(a.id).not.toBe(b.id);
    expect(await new RunStore(dir).list()).toHaveLength(2);
  });

  it("persists the plan markdown durably on the run when a phase returns it", async () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [{ id: "p1", executor: "p1", gates: [], humanGate: false }],
    };
    const eng = new WorkflowEngine({
      store: new RunStore(dir),
      definitions: { [def.name]: def },
      executors: {
        p1: { id: "p1", run: async () => ({ artifactRef: "art", planMarkdown: "# Plan\n## Task Graph" }) },
      },
      gates: {},
    });
    const run = await eng.start("w", "epic-1", "input");
    // Re-load from a fresh store to prove durability, not in-memory state.
    const reloaded = await new RunStore(dir).load(run.id);
    expect(reloaded?.planMarkdown).toBe("# Plan\n## Task Graph");
  });

  it("round-trips a verdict's captured rawOutput through the store", async () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [{ id: "p1", executor: "p1", gates: ["tactical"], humanGate: false }],
    };
    const verdictWithOutput: Gate = {
      name: "tactical",
      evaluate: async () => ({
        type: "gate",
        lens: "tactical",
        issues: [],
        verdict: "pass",
        rawOutput: "The plan is sound.\n{\"verdict\":\"pass\",\"issues\":[]}",
      }),
    };
    const eng = makeEngine(dir, def, [verdictWithOutput]);
    const run = await eng.start("w", "epic-1", "input");
    const reloaded = await new RunStore(dir).load(run.id);
    expect(reloaded?.verdicts[0].rawOutput).toContain("The plan is sound.");
  });

  it("marks the run failed (not stuck running) when a gate evaluate() throws", async () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [{ id: "p1", executor: "p1", gates: ["tactical"], humanGate: false }],
    };
    const eng = makeEngine(dir, def, [throwGate]);
    await expect(eng.start("w", "epic-1", "input")).rejects.toThrow(/boom/);
    const runs = await new RunStore(dir).list();
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].phaseStates["p1"]).toBe("failed");
    expect(runs[0].lastError).toEqual({ phase: "p1", message: "gate boom" });
  });
});

import type { Epic } from "../plan/types";

const EPIC: Epic = {
  id: "epic-1",
  title: "X",
  description: "",
  tasks: [
    { id: "a", title: "A", summary: "", complexity: "LOW", tdd: false, acceptanceCriteria: [], status: "backlog" },
    { id: "b", title: "B", summary: "", complexity: "LOW", tdd: false, acceptanceCriteria: [], status: "backlog" },
  ],
  dependencies: [],
};

/** Stub generate-backend: skips done tasks, supports single-task runTask. */
function trackingGen(spawns: string[]): PhaseExecutor {
  return {
    id: "gen",
    async run(ctx) {
      for (const t of ctx.epic!.tasks) {
        if (ctx.run.taskStatus[t.id] === "done") continue;
        spawns.push(t.id);
        await ctx.setTaskStatus(t.id, "done");
      }
      return { artifactRef: "art" };
    },
    async runTask(ctx, taskId) {
      spawns.push(taskId);
      await ctx.setTaskStatus(taskId, "done");
    },
  };
}

describe("WorkflowEngine resume/retry/abandon", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "eng2-"));
  });

  function engineWithGen(spawns: string[]) {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [{ id: "gen", executor: "gen", gates: [], humanGate: false }],
    };
    const store = new RunStore(dir);
    const engine = new WorkflowEngine({
      store,
      definitions: { w: def },
      executors: { gen: trackingGen(spawns) },
      gates: {},
    });
    return { engine, store, def };
  }

  it("abandon marks a stale running run terminal with a lastError", async () => {
    const { engine, store } = engineWithGen([]);
    await store.save({
      id: "run-x",
      workflow: "w",
      epicId: "epic-1",
      status: "running",
      currentPhaseIndex: 0,
      phaseStates: { gen: "running" },
      taskStatus: { a: "in_progress" },
      verdicts: [],
      pendingApproval: null,
      createdAt: "2026-06-08T00:00:00Z",
    });
    const run = await engine.abandon("run-x");
    expect(run.status).toBe("failed");
    expect(run.lastError?.phase).toBe("gen");
  });

  it("retryTask re-runs only the requested task, reusing the persisted epic", async () => {
    const spawns: string[] = [];
    const { engine, store } = engineWithGen(spawns);
    await store.save({
      id: "run-y",
      workflow: "w",
      epicId: "epic-1",
      status: "failed",
      currentPhaseIndex: 0,
      phaseStates: { gen: "failed" },
      taskStatus: { a: "done", b: "blocked" },
      verdicts: [],
      pendingApproval: null,
      createdAt: "2026-06-08T00:00:00Z",
      epic: EPIC,
    });
    const run = await engine.retryTask("run-y", "b");
    expect(spawns).toEqual(["b"]); // only task b re-spawned
    expect(run.taskStatus["b"]).toBe("done");
  });

  it("reconcile marks a running run with a dead engine pid as failed", async () => {
    const store = new RunStore(dir);
    const engine = new WorkflowEngine({
      store,
      definitions: { w: { name: "w", phases: [] } },
      executors: {},
      gates: {},
      isPidAlive: () => false, // engine process is gone
    });
    await store.save({
      id: "run-dead",
      workflow: "w",
      epicId: "e",
      status: "running",
      currentPhaseIndex: 0,
      phaseStates: {},
      taskStatus: {},
      verdicts: [],
      pendingApproval: null,
      createdAt: "2026-06-08T00:00:00Z",
      enginePid: 999999,
    });
    const run = await engine.reconcile("run-dead");
    expect(run.status).toBe("failed");
    expect(run.lastError?.message).toMatch(/no longer alive/);
  });

  it("reconcile leaves a run alone when its engine pid is still alive", async () => {
    const store = new RunStore(dir);
    const engine = new WorkflowEngine({
      store,
      definitions: { w: { name: "w", phases: [] } },
      executors: {},
      gates: {},
      isPidAlive: () => true,
    });
    await store.save({
      id: "run-live",
      workflow: "w",
      epicId: "e",
      status: "running",
      currentPhaseIndex: 0,
      phaseStates: {},
      taskStatus: {},
      verdicts: [],
      pendingApproval: null,
      createdAt: "2026-06-08T00:00:00Z",
      enginePid: 12345,
    });
    const run = await engine.reconcile("run-live");
    expect(run.status).toBe("running");
  });

  it("resumeRun re-drives advance and skips already-done tasks", async () => {
    const spawns: string[] = [];
    const { engine, store } = engineWithGen(spawns);
    await store.save({
      id: "run-z",
      workflow: "w",
      epicId: "epic-1",
      status: "failed",
      currentPhaseIndex: 0,
      phaseStates: { gen: "failed" },
      taskStatus: { a: "done", b: "blocked" },
      verdicts: [],
      pendingApproval: null,
      createdAt: "2026-06-08T00:00:00Z",
      epic: EPIC,
    });
    const run = await engine.resumeRun("run-z");
    expect(spawns).toEqual(["b"]); // task a skipped (already done)
    expect(run.status).toBe("completed");
  });
});
