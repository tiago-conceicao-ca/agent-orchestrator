import { describe, it, expect } from "vitest";
import type { SessionMetadata } from "../types.js";

describe("SessionMetadata SDLC fields", () => {
  it("accepts sdlcRunId, sdlcTaskId, sdlcPhase", () => {
    const m: SessionMetadata = {
      worktree: "/w",
      branch: "b",
      status: "working",
      sdlcRunId: "run-1",
      sdlcTaskId: "epic-1__repo-layer",
      sdlcPhase: "generate-backend",
    };
    expect(m.sdlcTaskId).toBe("epic-1__repo-layer");
    expect(m.sdlcRunId).toBe("run-1");
    expect(m.sdlcPhase).toBe("generate-backend");
  });
});
