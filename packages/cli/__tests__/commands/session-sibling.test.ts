import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SessionManager, Session } from "@aoagents/ao-core";
import type * as AoCore from "@aoagents/ao-core";

const { mockConfigRef, mockSessionManager } = vi.hoisted(() => ({
  mockConfigRef: { current: null as Record<string, unknown> | null },
  mockSessionManager: {
    list: vi.fn(),
    kill: vi.fn(),
    cleanup: vi.fn(),
    get: vi.fn(),
    spawn: vi.fn(),
    spawnOrchestrator: vi.fn(),
    send: vi.fn(),
    claimPR: vi.fn(),
    addSibling: vi.fn(),
    removeSibling: vi.fn(),
  },
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  const actual = await importOriginal<typeof AoCore>();
  return {
    ...actual,
    loadConfig: () => mockConfigRef.current,
  };
});

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async (): Promise<SessionManager> => mockSessionManager as SessionManager,
  getPluginRegistry: vi.fn(),
}));

import { Command } from "commander";
import { registerSession } from "../../src/commands/session.js";

let program: Command;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

function makeProgram(): Command {
  const p = new Command();
  p.exitOverride();
  registerSession(p);
  return p;
}

beforeEach(() => {
  mockConfigRef.current = {
    configPath: "/tmp/agent-orchestrator.yaml",
    port: 3000,
    defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: ["desktop"] },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: "/tmp/main-repo",
        defaultBranch: "main",
        sessionPrefix: "app",
        scm: { plugin: "github" },
      },
      "ds-front": {
        name: "Design System",
        repo: "org/ds-front",
        path: "/tmp/ds-front",
        defaultBranch: "master",
        scm: { plugin: "github" },
      },
    },
  } as Record<string, unknown>;

  program = makeProgram();
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  mockSessionManager.addSibling.mockReset();
  mockSessionManager.removeSibling.mockReset();
  mockSessionManager.get.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session sibling add", () => {
  it("mounts a sibling via the core and prints the result", async () => {
    mockSessionManager.addSibling.mockResolvedValue({
      repo: "ds-front",
      path: "/tmp/worktrees/app-1__sib__ds-front",
      branch: "sib/app-1/ds-front",
      mode: "worktree",
    });

    await program.parseAsync(["node", "test", "session", "sibling", "add", "app-1", "ds-front"]);

    expect(mockSessionManager.addSibling).toHaveBeenCalledWith("app-1", "ds-front", {
      branch: undefined,
      mode: undefined,
    });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ds-front");
    expect(output).toContain("sib/app-1/ds-front");
    expect(output).toContain("worktree");
  });

  it("passes --branch through to the core", async () => {
    mockSessionManager.addSibling.mockResolvedValue({
      repo: "ds-front",
      path: "/tmp/worktrees/app-1__sib__ds-front",
      branch: "release/2.0",
      mode: "worktree",
    });

    await program.parseAsync([
      "node",
      "test",
      "session",
      "sibling",
      "add",
      "app-1",
      "ds-front",
      "--branch",
      "release/2.0",
    ]);

    expect(mockSessionManager.addSibling).toHaveBeenCalledWith("app-1", "ds-front", {
      branch: "release/2.0",
      mode: undefined,
    });
  });

  it("passes --readonly as readonly-symlink mode", async () => {
    mockSessionManager.addSibling.mockResolvedValue({
      repo: "ds-front",
      path: "/tmp/worktrees/app-1__sib__ds-front",
      branch: "master",
      mode: "readonly-symlink",
    });

    await program.parseAsync([
      "node",
      "test",
      "session",
      "sibling",
      "add",
      "app-1",
      "ds-front",
      "--readonly",
    ]);

    expect(mockSessionManager.addSibling).toHaveBeenCalledWith("app-1", "ds-front", {
      branch: undefined,
      mode: "readonly-symlink",
    });
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("readonly-symlink");
  });

  it("exits 1 with a clear error when the repo is unknown", async () => {
    mockSessionManager.addSibling.mockRejectedValue(
      new Error('Unknown sibling repo "nope": no registered project matches that id or repo'),
    );

    await expect(
      program.parseAsync(["node", "test", "session", "sibling", "add", "app-1", "nope"]),
    ).rejects.toThrow("process.exit(1)");

    const errors = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errors).toContain("Unknown sibling repo");
  });
});

describe("session sibling ls", () => {
  it("lists mounted siblings for a session", async () => {
    mockSessionManager.get.mockResolvedValue({
      id: "app-1",
      projectId: "my-app",
      siblings: [
        {
          repo: "ds-front",
          path: "/tmp/worktrees/app-1__sib__ds-front",
          branch: "sib/app-1/ds-front",
          mode: "worktree",
        },
      ],
    } as unknown as Session);

    await program.parseAsync(["node", "test", "session", "sibling", "ls", "app-1"]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ds-front");
    expect(output).toContain("sib/app-1/ds-front");
    expect(output).toContain("worktree");
  });

  it("prints a friendly message when there are no siblings", async () => {
    mockSessionManager.get.mockResolvedValue({
      id: "app-1",
      projectId: "my-app",
      siblings: [],
    } as unknown as Session);

    await program.parseAsync(["node", "test", "session", "sibling", "ls", "app-1"]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output.toLowerCase()).toContain("no siblings");
  });

  it("exits 1 when the session does not exist", async () => {
    mockSessionManager.get.mockResolvedValue(null);

    await expect(
      program.parseAsync(["node", "test", "session", "sibling", "ls", "ghost"]),
    ).rejects.toThrow("process.exit(1)");

    const errors = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errors.toLowerCase()).toContain("ghost");
  });
});

describe("session sibling rm", () => {
  it("unmounts a sibling via the core and prints the result", async () => {
    mockSessionManager.removeSibling.mockResolvedValue(undefined);

    await program.parseAsync(["node", "test", "session", "sibling", "rm", "app-1", "ds-front"]);

    expect(mockSessionManager.removeSibling).toHaveBeenCalledWith("app-1", "ds-front");
    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("ds-front");
  });

  it("exits 1 with a clear error when the sibling is not mounted", async () => {
    mockSessionManager.removeSibling.mockRejectedValue(
      new Error('Sibling "ds-front" is not mounted on session app-1'),
    );

    await expect(
      program.parseAsync(["node", "test", "session", "sibling", "rm", "app-1", "ds-front"]),
    ).rejects.toThrow("process.exit(1)");

    const errors = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(errors).toContain("not mounted");
  });
});
