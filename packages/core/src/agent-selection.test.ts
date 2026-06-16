import { describe, it, expect } from "vitest";
import { resolveAgentSelection } from "./agent-selection.js";
import type { DefaultPlugins, ProjectConfig } from "./types.js";

const defaults: DefaultPlugins = {
  runtime: "tmux",
  agent: "claude-code",
  workspace: "worktree",
  notifiers: ["desktop"],
};

function project(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "App",
    repo: "org/app",
    path: "/tmp/app",
    defaultBranch: "main",
    sessionPrefix: "app",
    ...overrides,
  };
}

describe("resolveAgentSelection — spawnModelOverride", () => {
  it("spawn override wins over the project model for a worker", () => {
    const sel = resolveAgentSelection({
      role: "worker",
      project: project({ agentConfig: { model: "sonnet" } }),
      defaults,
      spawnModelOverride: "opus",
    });
    expect(sel.model).toBe("opus");
    expect(sel.agentConfig.model).toBe("opus");
  });

  it("falls back to the project model when no override is given (byte-identical)", () => {
    const sel = resolveAgentSelection({
      role: "worker",
      project: project({ agentConfig: { model: "sonnet" } }),
      defaults,
    });
    expect(sel.model).toBe("sonnet");
  });

  it("leaves model undefined when neither override nor project model is set", () => {
    const sel = resolveAgentSelection({ role: "worker", project: project(), defaults });
    expect(sel.model).toBeUndefined();
    expect(sel.agentConfig.model).toBeUndefined();
  });

  it("does not affect orchestrator model resolution", () => {
    const sel = resolveAgentSelection({
      role: "orchestrator",
      project: project({ agentConfig: { model: "sonnet", orchestratorModel: "opus" } }),
      defaults,
      spawnModelOverride: "haiku",
    });
    expect(sel.model).toBe("opus"); // orchestratorModel, override ignored for orchestrator
  });
});
