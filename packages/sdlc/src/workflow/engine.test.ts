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

  it("marks the run failed when a gate returns needs_fixes", async () => {
    const def: WorkflowDefinition = {
      name: "w",
      phases: [{ id: "p1", executor: "p1", gates: ["tactical"], humanGate: false }],
    };
    const eng = makeEngine(dir, def, [failGate]);
    const run = await eng.start("w", "epic-1", "input");
    const s = await eng.load(run.id);
    expect(s?.status).toBe("failed");
    expect(s?.verdicts[0].verdict).toBe("needs_fixes");
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
  });
});
