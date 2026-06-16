import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "./run-store";
import type { WorkflowRun } from "./types";

function sampleRun(id: string): WorkflowRun {
  return {
    id,
    workflow: "w",
    epicId: "e",
    status: "running",
    currentPhaseIndex: 0,
    phaseStates: {},
    taskStatus: {},
    verdicts: [],
    pendingApproval: null,
    createdAt: "2026-06-08T00:00:00Z",
  };
}

describe("RunStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdlc-"));
  });

  it("save then load round-trips a run", async () => {
    const store = new RunStore(dir);
    await store.save(sampleRun("run-1"));
    const loaded = await store.load("run-1");
    expect(loaded?.id).toBe("run-1");
  });
  it("load returns null for an unknown run", async () => {
    expect(await new RunStore(dir).load("ghost")).toBeNull();
  });
  it("list returns all saved runs", async () => {
    const store = new RunStore(dir);
    await store.save(sampleRun("a"));
    await store.save(sampleRun("b"));
    const ids = (await store.list()).map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });
  it("update applies a patch atomically", async () => {
    const store = new RunStore(dir);
    await store.save(sampleRun("run-1"));
    await store.update("run-1", (r) => ({ ...r, status: "completed" }));
    expect((await store.load("run-1"))?.status).toBe("completed");
  });

  it("serializes concurrent updates without losing writes (parallel scheduler)", async () => {
    const store = new RunStore(dir);
    await store.save(sampleRun("run-1"));
    // 50 concurrent appends to taskStatus — without serialization, the
    // read-modify-write cycles would clobber each other and lose entries.
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        store.update("run-1", (r) => ({
          ...r,
          taskStatus: { ...r.taskStatus, [`t${i}`]: "done" },
        })),
      ),
    );
    const loaded = await store.load("run-1");
    expect(Object.keys(loaded?.taskStatus ?? {})).toHaveLength(50);
  });
});
