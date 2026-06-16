import { describe, it, expect } from "vitest";
import {
  makeGenerateBackendExecutor,
  PASS_MAX_FIX_ATTEMPTS,
  type ReadPassVerdictFn,
  type SpawnFn,
} from "./generate-backend";
import { expandTaskPasses } from "../passes/expand";
import type { Epic, WorkflowTask, Dependency } from "../plan/types";
import type { GateVerdict, LensIssue } from "../gates/types";
import type { PhaseContext, PrMode } from "../workflow/types";

function task(id: string, complexity: WorkflowTask["complexity"]): WorkflowTask {
  return { id, title: id, summary: "", complexity, tdd: false, acceptanceCriteria: ["c"], status: "backlog" };
}
function epicWithPasses(tasks: WorkflowTask[], dependencies: Dependency[] = []): Epic {
  return { id: "epic-1", title: "X", description: "", tasks: expandTaskPasses(tasks, dependencies), dependencies };
}
function verdict(v: "pass" | "needs_fixes", issues: LensIssue[] = []): GateVerdict {
  return { type: "gate", lens: "x", verdict: v, issues };
}
function harness(epic: Epic, prMode?: PrMode) {
  const statuses: Record<string, string> = {};
  const recorded: GateVerdict[] = [];
  return {
    statuses,
    recorded,
    ctx: {
      run: {
        id: "run-1", workflow: "w", epicId: "epic-1", status: "running" as const,
        currentPhaseIndex: 1, phaseStates: {}, taskStatus: {}, verdicts: [], pendingApproval: null,
        createdAt: "2026-06-08T00:00:00Z", prMode,
      },
      epic, input: "", log: () => {},
      setTaskStatus: async (id: string, s: string) => { statuses[id] = s; },
      setTaskProgress: async () => {},
      recordVerdict: async (v: GateVerdict) => { recorded.push(v); },
    } as PhaseContext,
  };
}

describe("generate-backend — bounded auto re-dispatch on needs_fixes", () => {
  it("re-dispatches a needs_fixes pass with the feedback appended, then passes", async () => {
    const prompts: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      prompts.push(cfg.prompt);
      return { id: `s-${prompts.length}`, workspacePath: "/wt/t" };
    };
    // The 'correctness' pass needs_fixes once, then passes; all others pass.
    let correctnessSeen = 0;
    const readPassVerdict: ReadPassVerdictFn = async ({ pass }) => {
      if (pass.role !== "correctness") return verdict("pass");
      correctnessSeen++;
      return correctnessSeen === 1
        ? verdict("needs_fixes", [{ severity: "high", title: "Bug", detail: "UNIQUE-FEEDBACK-MARKER" }])
        : verdict("pass");
    };
    const exec = makeGenerateBackendExecutor({
      spawn,
      projectId: "b",
      waitForDone: async () => "done",
      readPassVerdict,
    });
    const { ctx, statuses, recorded } = harness(epicWithPasses([task("t", "LOW")]));
    await exec.run(ctx);

    // LOW = 3 passes, but correctness ran twice (initial fail + fix) → 4 spawns.
    expect(prompts).toHaveLength(4);
    // The fix re-dispatch carries the prior issue feedback.
    const fixPrompt = prompts.find((p) => p.includes("UNIQUE-FEEDBACK-MARKER"));
    expect(fixPrompt).toBeDefined();
    expect(fixPrompt).toContain("returned needs_fixes");
    expect(statuses["t"]).toBe("done");
    // Both correctness verdicts recorded as history (needs_fixes then pass).
    expect(recorded.filter((v) => v.verdict === "needs_fixes")).toHaveLength(1);
  });

  it("fails the task after exhausting the bounded fix attempts (no human wait)", async () => {
    const spawnCount: Record<string, number> = {};
    const spawn: SpawnFn = async (cfg) => {
      spawnCount[cfg.sdlcTaskId] = (spawnCount[cfg.sdlcTaskId] ?? 0) + 1;
      return { id: `s-${cfg.sdlcTaskId}-${spawnCount[cfg.sdlcTaskId]}`, workspacePath: "/wt/t" };
    };
    // correctness always needs_fixes; initial passes.
    const readPassVerdict: ReadPassVerdictFn = async ({ pass }) =>
      pass.role === "correctness"
        ? verdict("needs_fixes", [{ severity: "high", title: "X", detail: "Y" }])
        : verdict("pass");
    const exec = makeGenerateBackendExecutor({
      spawn,
      projectId: "b",
      waitForDone: async () => "done",
      readPassVerdict,
    });
    const { ctx, statuses } = harness(epicWithPasses([task("t", "LOW")]));
    await expect(exec.run(ctx)).rejects.toThrow(/still needs fixes after 3 attempts/i);
    expect(statuses["t"]).toBe("blocked");
    // initial (1) + correctness tried PASS_MAX_FIX_ATTEMPTS times.
    expect(spawnCount["t"]).toBe(1 + PASS_MAX_FIX_ATTEMPTS);
  });

  it("a needs_fixes loop on one task does not block an independent task", async () => {
    const spawnedTasks: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      spawnedTasks.push(cfg.sdlcTaskId);
      return { id: `s-${cfg.sdlcTaskId}-${spawnedTasks.length}`, workspacePath: `/wt/${cfg.worktreeKey}` };
    };
    // task 'a' correctness fails forever; 'b' is independent and passes.
    const readPassVerdict: ReadPassVerdictFn = async ({ task: t, pass }) =>
      t.id === "a" && pass.role === "correctness"
        ? verdict("needs_fixes", [{ severity: "medium", title: "x", detail: "y" }])
        : verdict("pass");
    const exec = makeGenerateBackendExecutor({
      spawn,
      projectId: "b",
      waitForDone: async () => "done",
      readPassVerdict,
      maxConcurrent: 4,
    });
    const { ctx } = harness(epicWithPasses([task("a", "LOW"), task("b", "LOW")]));
    await expect(exec.run(ctx)).rejects.toThrow(/needs fixes/i);
    // 'b' completed all 3 of its passes despite 'a' looping/failing.
    expect(spawnedTasks.filter((t) => t === "b")).toHaveLength(3);
  });

  it("without readPassVerdict, a pass completes on the worker done signal (no gating)", async () => {
    const spawnCount: Record<string, number> = {};
    const spawn: SpawnFn = async (cfg) => {
      spawnCount[cfg.sdlcTaskId] = (spawnCount[cfg.sdlcTaskId] ?? 0) + 1;
      return { id: "s", workspacePath: "/wt/t" };
    };
    const exec = makeGenerateBackendExecutor({ spawn, projectId: "b", waitForDone: async () => "done" });
    const { ctx, statuses } = harness(epicWithPasses([task("t", "LOW")]));
    await exec.run(ctx);
    expect(spawnCount["t"]).toBe(3); // exactly one spawn per pass, no re-dispatch
    expect(statuses["t"]).toBe("done");
  });
});

describe("generate-backend — post-impl gate pipeline (runTaskGates)", () => {
  it("runs the gate pipeline AFTER a task's passes complete", async () => {
    const events: string[] = [];
    const spawn: SpawnFn = async (cfg) => {
      events.push(`pass:${cfg.sdlcTaskId}`);
      return { id: "s", workspacePath: "/wt/t" };
    };
    const exec = makeGenerateBackendExecutor({
      spawn,
      projectId: "b",
      waitForDone: async () => "done",
      runTaskGates: async (_task, artifactRef) => {
        events.push(`gates:${artifactRef}`);
      },
    });
    const { ctx, statuses } = harness(epicWithPasses([task("t", "LOW")]));
    await exec.run(ctx);
    // 3 passes, then the gate pipeline over the shared worktree.
    expect(events).toEqual(["pass:t", "pass:t", "pass:t", "gates:/wt/t"]);
    expect(statuses["t"]).toBe("done");
  });

  it("a failing gate pipeline blocks the task", async () => {
    const spawn: SpawnFn = async () => ({ id: "s", workspacePath: "/wt/t" });
    const exec = makeGenerateBackendExecutor({
      spawn,
      projectId: "b",
      waitForDone: async () => "done",
      runTaskGates: async () => {
        throw new Error("Quality gate 'test' failed: 2 tests failed");
      },
    });
    const { ctx, statuses } = harness(epicWithPasses([task("t", "LOW")]));
    await expect(exec.run(ctx)).rejects.toThrow(/Quality gate 'test' failed/);
    expect(statuses["t"]).toBe("blocked");
  });
});
