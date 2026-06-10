import { describe, it, expect } from "vitest";
import type { Session } from "@aoagents/ao-core";
import { buildSdlcServices, classifyTerminal } from "../src/commands/sdlc.js";

/** Minimal Session fake: only the fields classifyTerminal reads. */
function fakeSession(
  status: Session["status"],
  pr?: { state: "none" | "open" | "merged" | "closed"; reason?: string },
): Session {
  return {
    status,
    lifecycle: pr ? { pr: { state: pr.state, reason: pr.reason } } : undefined,
  } as unknown as Session;
}

describe("classifyTerminal", () => {
  it("returns 'done' when a PR is open and CI is not failing (no merge required)", () => {
    expect(classifyTerminal(fakeSession("pr_open", { state: "open" }))).toBe("done");
  });

  it("returns 'done' from lifecycle PR state even if legacy status is still working", () => {
    expect(classifyTerminal(fakeSession("working", { state: "open", reason: "review_pending" }))).toBe(
      "done",
    );
  });

  it("returns 'done' for review_pending / mergeable / merged legacy statuses", () => {
    expect(classifyTerminal(fakeSession("review_pending"))).toBe("done");
    expect(classifyTerminal(fakeSession("mergeable"))).toBe("done");
    expect(classifyTerminal(fakeSession("merged", { state: "merged" }))).toBe("done");
  });

  it("returns 'failed' for errored / killed / terminated", () => {
    expect(classifyTerminal(fakeSession("errored"))).toBe("failed");
    expect(classifyTerminal(fakeSession("killed"))).toBe("failed");
    expect(classifyTerminal(fakeSession("terminated"))).toBe("failed");
  });

  it("returns 'failed' when a PR exists but its CI is failing", () => {
    expect(classifyTerminal(fakeSession("ci_failed", { state: "open" }))).toBe("failed");
    expect(classifyTerminal(fakeSession("working", { state: "open", reason: "ci_failing" }))).toBe(
      "failed",
    );
  });

  it("returns null while still working with no PR yet (keep polling)", () => {
    expect(classifyTerminal(fakeSession("working"))).toBeNull();
    expect(classifyTerminal(fakeSession("spawning"))).toBeNull();
  });
});

describe("buildSdlcServices", () => {
  it("constructs an engine wired with both phase executors", () => {
    const fakeSM = { spawn: async () => ({ id: "s" }), get: async () => null } as never;
    const { engine } = buildSdlcServices({
      baseDir: "/tmp/x",
      sessionManager: fakeSM,
      projectId: "backend",
      runLensAgent: async () => "{}",
      runEvalCommand: async () => "{}",
      runPlanWriteAgent: async () => "",
    });
    expect(engine).toBeDefined();
  });

  it("exposes a store alongside the engine", () => {
    const fakeSM = { spawn: async () => ({ id: "s" }), get: async () => null } as never;
    const { store } = buildSdlcServices({
      baseDir: "/tmp/x",
      sessionManager: fakeSM,
      projectId: "backend",
      runLensAgent: async () => "{}",
      runEvalCommand: async () => "{}",
      runPlanWriteAgent: async () => "",
    });
    expect(store).toBeDefined();
  });
});
