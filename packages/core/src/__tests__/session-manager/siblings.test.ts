import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { writeMetadata, readMetadataRaw } from "../../metadata.js";
import { getProjectWorktreesDir } from "../../paths.js";
import {
  parseSiblings,
  assembledViewDir,
  assembledPrimaryViewPath,
} from "../../utils/siblings.js";
import {
  type OrchestratorConfig,
  type ProjectConfig,
  type Workspace,
} from "../../types.js";
import {
  setupTestContext,
  teardownTestContext,
  makeHandle,
  type TestContext,
} from "../test-utils.js";

let ctx: TestContext;
let sessionsDir: string;
let config: OrchestratorConfig;

beforeEach(() => {
  ctx = setupTestContext();
  ({ sessionsDir, config } = ctx);
});

afterEach(() => {
  teardownTestContext(ctx);
});

describe("addSibling / removeSibling (#1095)", () => {
  /** The source repo for the sibling — a second registered project (the catalog). */
  function libSharedProject(): ProjectConfig {
    return {
      name: "Lib Shared",
      repo: "org/lib-shared",
      path: join(ctx.tmpDir, "lib-shared"),
      defaultBranch: "master",
      sessionPrefix: "lib",
    };
  }

  function uiKitProject(): ProjectConfig {
    return {
      name: "UI Kit",
      repo: "org/ui-kit",
      path: join(ctx.tmpDir, "ui-kit"),
      defaultBranch: "main",
      sessionPrefix: "ui",
    };
  }

  /** Config with the session project (my-app) plus two sibling source projects. */
  function configWithSibling(): OrchestratorConfig {
    return {
      ...config,
      projects: {
        ...config.projects,
        "lib-shared": libSharedProject(),
        "ui-kit": uiKitProject(),
      },
    };
  }

  /** Workspace mock that mirrors the real worktree path scheme: {worktreeDir}/{sessionId}.
   *  Materializes the worktree dir on disk so adjacency symlinks resolve to a real target. */
  function pathAwareWorkspace(): Workspace {
    return {
      name: "mock-ws",
      create: vi.fn().mockImplementation(async (cfg) => {
        const path = join(cfg.worktreeDir, cfg.sessionId);
        mkdirSync(path, { recursive: true });
        return { path, branch: cfg.branch, sessionId: cfg.sessionId, projectId: cfg.projectId };
      }),
      destroy: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      findManagedWorkspace: vi.fn().mockResolvedValue(null),
    };
  }

  function makeManager(workspace: Workspace, cfg = configWithSibling()) {
    const registry = {
      ...ctx.mockRegistry,
      get: vi.fn().mockImplementation((slot: string) => {
        if (slot === "runtime") return ctx.mockRuntime;
        if (slot === "agent") return ctx.mockAgent;
        if (slot === "workspace") return workspace;
        return null;
      }),
    };
    return createSessionManager({ config: cfg, registry });
  }

  function writeWorker(sessionId: string): void {
    const worktree = join(getProjectWorktreesDir("my-app"), sessionId);
    mkdirSync(worktree, { recursive: true });
    writeMetadata(sessionsDir, sessionId, {
      worktree,
      branch: "feat/work",
      status: "working",
      project: "my-app",
      runtimeHandle: makeHandle(`rt-${sessionId}`),
    });
  }

  it("mounts a sibling as an isolated per-session worktree and records it in metadata", async () => {
    const workspace = pathAwareWorkspace();
    writeWorker("app-1");

    const sm = makeManager(workspace);
    const ref = await sm.addSibling("app-1", "lib-shared");

    expect(ref.repo).toBe("lib-shared");
    expect(ref.mode).toBe("worktree");
    expect(ref.path).toBe(
      join(getProjectWorktreesDir("my-app"), "app-1__sib__lib-shared"),
    );
    expect(ref.branch).toBeTruthy();

    // The worktree is cut from the SOURCE repo (lib-shared), not the session repo.
    const createCall = (workspace.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createCall.project.path).toBe(join(ctx.tmpDir, "lib-shared"));
    expect(createCall.sessionId).toBe("app-1__sib__lib-shared");

    const raw = readMetadataRaw(sessionsDir, "app-1");
    expect(parseSiblings(raw!)).toEqual([ref]);
  });

  it("gives two parallel sessions different worktrees for the same sibling (no collision)", async () => {
    const workspace = pathAwareWorkspace();
    writeWorker("app-1");
    writeWorker("app-2");

    const sm = makeManager(workspace);
    const ref1 = await sm.addSibling("app-1", "lib-shared");
    const ref2 = await sm.addSibling("app-2", "lib-shared");

    expect(ref1.path).not.toBe(ref2.path);
    expect(ref1.path).toContain("app-1__sib__lib-shared");
    expect(ref2.path).toContain("app-2__sib__lib-shared");
    expect(ref1.branch).not.toBe(ref2.branch);
  });

  it("resolves the source by repo owner/name as well as by project id", async () => {
    const workspace = pathAwareWorkspace();
    writeWorker("app-1");

    const sm = makeManager(workspace);
    const ref = await sm.addSibling("app-1", "org/lib-shared");
    expect(ref.repo).toBe("lib-shared");
  });

  it("throws for an unknown sibling repo", async () => {
    const workspace = pathAwareWorkspace();
    writeWorker("app-1");

    const sm = makeManager(workspace);
    await expect(sm.addSibling("app-1", "does-not-exist")).rejects.toThrow(/unknown sibling/i);
  });

  it("throws when the sibling is already mounted", async () => {
    const workspace = pathAwareWorkspace();
    writeWorker("app-1");

    const sm = makeManager(workspace);
    await sm.addSibling("app-1", "lib-shared");
    await expect(sm.addSibling("app-1", "lib-shared")).rejects.toThrow(/already mounted/i);
  });

  it("readonly-symlink mode creates a symlink to the source, not a worktree", async () => {
    const workspace = pathAwareWorkspace();
    // The source repo must exist on disk for a symlink to resolve.
    const sourcePath = join(ctx.tmpDir, "lib-shared");
    mkdirSync(sourcePath, { recursive: true });
    writeFileSync(join(sourcePath, "MARKER.txt"), "hello");
    writeWorker("app-1");

    const sm = makeManager(workspace);
    const ref = await sm.addSibling("app-1", "lib-shared", { mode: "readonly-symlink" });

    expect(ref.mode).toBe("readonly-symlink");
    expect(workspace.create).not.toHaveBeenCalled();
    // The mounted path resolves to the source repo (through the symlink/junction).
    expect(existsSync(join(ref.path, "MARKER.txt"))).toBe(true);
    expect(lstatSync(ref.path).isSymbolicLink()).toBe(true);
  });

  it("removeSibling tears down the worktree and drops it from metadata", async () => {
    const workspace = pathAwareWorkspace();
    writeWorker("app-1");

    const sm = makeManager(workspace);
    const ref = await sm.addSibling("app-1", "lib-shared");

    await sm.removeSibling("app-1", "lib-shared");

    expect(workspace.destroy).toHaveBeenCalledWith(ref.path);
    const raw = readMetadataRaw(sessionsDir, "app-1");
    expect(parseSiblings(raw!)).toEqual([]);
  });

  it("removeSibling throws when the sibling is not mounted", async () => {
    const workspace = pathAwareWorkspace();
    writeWorker("app-1");

    const sm = makeManager(workspace);
    await expect(sm.removeSibling("app-1", "lib-shared")).rejects.toThrow(/not mounted/i);
  });

  it("removeSibling unlinks a readonly-symlink sibling", async () => {
    const workspace = pathAwareWorkspace();
    const sourcePath = join(ctx.tmpDir, "lib-shared");
    mkdirSync(sourcePath, { recursive: true });
    writeWorker("app-1");

    const sm = makeManager(workspace);
    const ref = await sm.addSibling("app-1", "lib-shared", { mode: "readonly-symlink" });
    expect(existsSync(ref.path)).toBe(true);

    await sm.removeSibling("app-1", "lib-shared");
    expect(existsSync(ref.path)).toBe(false);
    const raw = readMetadataRaw(sessionsDir, "app-1");
    expect(parseSiblings(raw!)).toEqual([]);
  });

  it("kill removes the session's sibling worktrees and symlinks (best-effort cleanup)", async () => {
    const workspace = pathAwareWorkspace();
    // ui-kit is mounted read-only, so its source must exist for the symlink.
    mkdirSync(join(ctx.tmpDir, "ui-kit"), { recursive: true });
    writeWorker("app-1");

    const sm = makeManager(workspace);
    const worktreeRef = await sm.addSibling("app-1", "lib-shared");
    const symlinkRef = await sm.addSibling("app-1", "ui-kit", {
      mode: "readonly-symlink",
    });
    expect(existsSync(symlinkRef.path)).toBe(true);

    await sm.kill("app-1");

    expect(workspace.destroy).toHaveBeenCalledWith(worktreeRef.path);
    expect(existsSync(symlinkRef.path)).toBe(false);
  });

  describe("../{name} adjacency view (#1095 Decision 3 / Option 1)", () => {
    /** The per-session assembled-view dir and primary-view path for "my-app"/"app-1". */
    const viewDir = () => assembledViewDir(getProjectWorktreesDir("my-app"), "app-1");
    const primaryView = () =>
      assembledPrimaryViewPath(getProjectWorktreesDir("my-app"), "app-1", "my-app");

    it("assembles a per-session view where ../{repoName} resolves to the sibling worktree", async () => {
      const workspace = pathAwareWorkspace();
      writeWorker("app-1");

      const sm = makeManager(workspace);
      const ref = await sm.addSibling("app-1", "lib-shared");

      // From the assembled primary view, ../lib-shared resolves (through the
      // symlink) to the sibling's isolated worktree.
      const adjacent = join(primaryView(), "..", "lib-shared");
      expect(realpathSync(adjacent)).toBe(realpathSync(ref.path));
    });

    it("names the symlinks by the real repo name (primary + each sibling)", async () => {
      const workspace = pathAwareWorkspace();
      writeWorker("app-1");

      const sm = makeManager(workspace);
      await sm.addSibling("app-1", "lib-shared");
      await sm.addSibling("app-1", "ui-kit");

      // The primary repo (my-app) plus both siblings, each under its real name.
      expect(readdirSync(viewDir()).sort()).toEqual(["lib-shared", "my-app", "ui-kit"]);
      expect(lstatSync(join(viewDir(), "my-app")).isSymbolicLink()).toBe(true);
      // The primary symlink points at the session's primary worktree.
      expect(realpathSync(join(viewDir(), "my-app"))).toBe(
        realpathSync(join(getProjectWorktreesDir("my-app"), "app-1")),
      );
    });

    it("exposes the assembled primary-view path on the session", async () => {
      const workspace = pathAwareWorkspace();
      writeWorker("app-1");

      const sm = makeManager(workspace);
      await sm.addSibling("app-1", "lib-shared");

      const session = await sm.get("app-1");
      expect(session?.assembledViewPath).toBe(primaryView());
    });

    it("gives two parallel sessions separate __ws dirs (no collision)", async () => {
      const workspace = pathAwareWorkspace();
      writeWorker("app-1");
      writeWorker("app-2");

      const sm = makeManager(workspace);
      await sm.addSibling("app-1", "lib-shared");
      await sm.addSibling("app-2", "lib-shared");

      const view1 = assembledViewDir(getProjectWorktreesDir("my-app"), "app-1");
      const view2 = assembledViewDir(getProjectWorktreesDir("my-app"), "app-2");
      expect(view1).not.toBe(view2);
      expect(existsSync(view1)).toBe(true);
      expect(existsSync(view2)).toBe(true);
      // app-2's view does not contain app-1's sibling link, and vice versa —
      // each ../lib-shared resolves to that session's own worktree.
      expect(realpathSync(join(view1, "lib-shared"))).not.toBe(
        realpathSync(join(view2, "lib-shared")),
      );
    });

    it("removeSibling drops the sibling's adjacency link but keeps the view", async () => {
      const workspace = pathAwareWorkspace();
      writeWorker("app-1");

      const sm = makeManager(workspace);
      await sm.addSibling("app-1", "lib-shared");
      await sm.addSibling("app-1", "ui-kit");

      await sm.removeSibling("app-1", "lib-shared");

      expect(existsSync(join(viewDir(), "lib-shared"))).toBe(false);
      // ui-kit and the primary link survive.
      expect(readdirSync(viewDir()).sort()).toEqual(["my-app", "ui-kit"]);
    });

    it("kill removes the entire __ws view", async () => {
      const workspace = pathAwareWorkspace();
      writeWorker("app-1");

      const sm = makeManager(workspace);
      await sm.addSibling("app-1", "lib-shared");
      expect(existsSync(viewDir())).toBe(true);

      await sm.kill("app-1");
      expect(existsSync(viewDir())).toBe(false);
    });

    it("assembles the view for a readonly-symlink sibling: ../{name} resolves to the source", async () => {
      const workspace = pathAwareWorkspace();
      const sourcePath = join(ctx.tmpDir, "lib-shared");
      mkdirSync(sourcePath, { recursive: true });
      writeFileSync(join(sourcePath, "MARKER.txt"), "hello");
      writeWorker("app-1");

      const sm = makeManager(workspace);
      const ref = await sm.addSibling("app-1", "lib-shared", { mode: "readonly-symlink" });

      // From the assembled primary view, ../lib-shared resolves (through the
      // view link and the per-session readonly symlink) to the SOURCE repo.
      const adjacent = join(primaryView(), "..", "lib-shared");
      expect(realpathSync(adjacent)).toBe(realpathSync(sourcePath));
      expect(existsSync(join(adjacent, "MARKER.txt"))).toBe(true);
      // The view links to the per-session symlink (the mounted ref), not straight
      // to the source — removeSibling stays uniform across modes.
      expect(realpathSync(join(viewDir(), "lib-shared"))).toBe(realpathSync(ref.path));

      const session = await sm.get("app-1");
      expect(session?.assembledViewPath).toBe(primaryView());
    });

    it("gives two parallel sessions separate __ws views for the same readonly source", async () => {
      const workspace = pathAwareWorkspace();
      mkdirSync(join(ctx.tmpDir, "lib-shared"), { recursive: true });
      writeWorker("app-1");
      writeWorker("app-2");

      const sm = makeManager(workspace);
      const ref1 = await sm.addSibling("app-1", "lib-shared", { mode: "readonly-symlink" });
      const ref2 = await sm.addSibling("app-2", "lib-shared", { mode: "readonly-symlink" });

      const view1 = assembledViewDir(getProjectWorktreesDir("my-app"), "app-1");
      const view2 = assembledViewDir(getProjectWorktreesDir("my-app"), "app-2");
      expect(view1).not.toBe(view2);
      expect(existsSync(view1)).toBe(true);
      expect(existsSync(view2)).toBe(true);
      // Each session owns a distinct per-session symlink and view link; only the
      // final target (the read-only source) is shared.
      expect(ref1.path).not.toBe(ref2.path);
      expect(lstatSync(join(view1, "lib-shared")).isSymbolicLink()).toBe(true);
      expect(lstatSync(join(view2, "lib-shared")).isSymbolicLink()).toBe(true);
    });

    it("removeSibling after a readonly mount leaves no orphan symlink or adjacency link", async () => {
      const workspace = pathAwareWorkspace();
      mkdirSync(join(ctx.tmpDir, "lib-shared"), { recursive: true });
      writeWorker("app-1");

      const sm = makeManager(workspace);
      const ref = await sm.addSibling("app-1", "lib-shared", { mode: "readonly-symlink" });
      expect(existsSync(ref.path)).toBe(true);
      expect(existsSync(join(viewDir(), "lib-shared"))).toBe(true);

      await sm.removeSibling("app-1", "lib-shared");

      expect(existsSync(ref.path)).toBe(false);
      expect(existsSync(join(viewDir(), "lib-shared"))).toBe(false);
      const raw = readMetadataRaw(sessionsDir, "app-1");
      expect(parseSiblings(raw!)).toEqual([]);
    });

    it("kill removes the __ws view of a readonly-symlink-only session", async () => {
      const workspace = pathAwareWorkspace();
      mkdirSync(join(ctx.tmpDir, "lib-shared"), { recursive: true });
      writeWorker("app-1");

      const sm = makeManager(workspace);
      await sm.addSibling("app-1", "lib-shared", { mode: "readonly-symlink" });
      expect(existsSync(viewDir())).toBe(true);

      await sm.kill("app-1");
      expect(existsSync(viewDir())).toBe(false);
    });
  });
});
