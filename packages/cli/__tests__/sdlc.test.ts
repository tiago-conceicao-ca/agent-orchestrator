import { describe, it, expect } from "vitest";
import { buildSdlcServices } from "../src/commands/sdlc.js";

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
