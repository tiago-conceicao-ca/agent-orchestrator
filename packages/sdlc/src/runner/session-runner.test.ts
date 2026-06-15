import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSessionBackedAgent, type SdlcSessionSpawn } from "./session-runner.js";

/**
 * Build a fake session manager whose spawned session writes (or doesn't write)
 * the sentinel file synchronously, plus a kill spy so teardown can be asserted.
 */
function makeFakeSpawn(opts: {
  workspaceDir: string | null;
  sentinelName?: string;
  sentinelContents?: string | null; // null = never write the file
}): { sm: SdlcSessionSpawn; killed: string[]; spawnedMeta: Record<string, string>[] } {
  const killed: string[] = [];
  const spawnedMeta: Record<string, string>[] = [];
  const sm: SdlcSessionSpawn = {
    spawn: async ({ metadata }) => {
      spawnedMeta.push(metadata);
      if (opts.workspaceDir && opts.sentinelContents !== null) {
        const aoDir = join(opts.workspaceDir, ".ao");
        mkdirSync(aoDir, { recursive: true });
        writeFileSync(
          join(aoDir, opts.sentinelName ?? "sdlc-output"),
          opts.sentinelContents ?? "",
          "utf-8",
        );
      }
      return { id: "sess-1", workspacePath: opts.workspaceDir };
    },
    kill: async (id) => {
      killed.push(id);
    },
  };
  return { sm, killed, spawnedMeta };
}

describe("runSessionBackedAgent", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sess-runner-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the sentinel contents and tears the session down on success", async () => {
    const { sm, killed, spawnedMeta } = makeFakeSpawn({
      workspaceDir: dir,
      sentinelName: "sdlc-output.json",
      sentinelContents: '{"verdict":"pass"}',
    });
    const out = await runSessionBackedAgent(sm, {
      prompt: "review the plan",
      sentinelName: "sdlc-output.json",
      runId: "run-1",
      phase: "lens:tactical",
      role: "lens",
      pollIntervalMs: 5,
    });
    expect(out).toBe('{"verdict":"pass"}');
    expect(killed).toEqual(["sess-1"]);
    expect(spawnedMeta[0]).toEqual({
      sdlcRunId: "run-1",
      sdlcPhase: "lens:tactical",
      sdlcRole: "lens",
    });
  });

  it("rejects on timeout when the sentinel never appears, and still tears down", async () => {
    const { sm, killed } = makeFakeSpawn({ workspaceDir: dir, sentinelContents: null });
    await expect(
      runSessionBackedAgent(sm, {
        prompt: "p",
        sentinelName: "sdlc-output.md",
        runId: "run-2",
        phase: "normalize-plan",
        role: "plan",
        timeoutMs: 40,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow(/did not produce sdlc-output\.md/i);
    expect(killed).toEqual(["sess-1"]);
  });

  it("rejects when the session has no workspace path, and still tears down", async () => {
    const { sm, killed } = makeFakeSpawn({ workspaceDir: null });
    await expect(
      runSessionBackedAgent(sm, {
        prompt: "p",
        sentinelName: "sdlc-output.json",
        runId: "run-3",
        phase: "lens:architectural",
        role: "lens",
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow(/no workspace path/i);
    expect(killed).toEqual(["sess-1"]);
  });

  it("rejects when the sentinel is present but empty, and still tears down", async () => {
    const { sm, killed } = makeFakeSpawn({
      workspaceDir: dir,
      sentinelName: "sdlc-output.json",
      sentinelContents: "   \n",
    });
    await expect(
      runSessionBackedAgent(sm, {
        prompt: "p",
        sentinelName: "sdlc-output.json",
        runId: "run-4",
        phase: "lens:tactical",
        role: "lens",
        timeoutMs: 40,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow(/empty/i);
    expect(killed).toEqual(["sess-1"]);
  });

  it("tears down even when kill itself throws (best-effort)", async () => {
    const { sm } = makeFakeSpawn({
      workspaceDir: dir,
      sentinelName: "sdlc-output.json",
      sentinelContents: '{"verdict":"pass"}',
    });
    const throwingSm: SdlcSessionSpawn = {
      spawn: sm.spawn,
      kill: async () => {
        throw new Error("kill failed");
      },
    };
    const out = await runSessionBackedAgent(throwingSm, {
      prompt: "p",
      sentinelName: "sdlc-output.json",
      runId: "run-5",
      phase: "lens:tactical",
      role: "lens",
      pollIntervalMs: 5,
    });
    expect(out).toBe('{"verdict":"pass"}');
  });
});
