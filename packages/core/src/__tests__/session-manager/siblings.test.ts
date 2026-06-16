import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createSessionManager } from "../../session-manager.js";
import { loadConfig } from "../../config.js";
import { registerProjectInGlobalConfig } from "../../global-config.js";
import { queryActivityEvents } from "../../query-activity-events.js";
import { writeMetadata, readMetadataRaw, updateMetadata } from "../../metadata.js";
import { getProjectWorktreesDir } from "../../paths.js";
import {
  parseSiblings,
  serializeSiblings,
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

  describe("auto-mount at spawn (project.siblings, #1095)", () => {
    /** configWithSibling, with the given siblings configured on my-app. */
    function configWithProjectSiblings(siblings: string[]): OrchestratorConfig {
      const cfg = configWithSibling();
      const myApp = cfg.projects["my-app"];
      if (!myApp) throw new Error("test setup: my-app missing");
      return {
        ...cfg,
        projects: { ...cfg.projects, "my-app": { ...myApp, siblings } },
      };
    }

    it("mounts configured siblings as readonly symlinks with working adjacency", async () => {
      const workspace = pathAwareWorkspace();
      const sourcePath = join(ctx.tmpDir, "lib-shared");
      mkdirSync(sourcePath, { recursive: true });
      writeFileSync(join(sourcePath, "MARKER.txt"), "hello");

      const sm = makeManager(workspace, configWithProjectSiblings(["lib-shared"]));
      const session = await sm.spawn({ projectId: "my-app" });

      expect(session.siblings).toHaveLength(1);
      const ref = session.siblings[0]!;
      expect(ref.repo).toBe("lib-shared");
      expect(ref.mode).toBe("readonly-symlink");
      expect(lstatSync(ref.path).isSymbolicLink()).toBe(true);

      // ../{name} adjacency from the assembled primary view resolves to the source.
      expect(session.assembledViewPath).toBe(
        assembledPrimaryViewPath(getProjectWorktreesDir("my-app"), session.id, "my-app"),
      );
      const adjacent = join(session.assembledViewPath!, "..", "lib-shared");
      expect(realpathSync(adjacent)).toBe(realpathSync(sourcePath));

      // The mounted refs are persisted in metadata.
      const raw = readMetadataRaw(sessionsDir, session.id);
      expect(parseSiblings(raw!)).toEqual([ref]);
    });

    it("skips an unresolvable configured sibling and proceeds (no rollback), still mounting the valid one", async () => {
      const workspace = pathAwareWorkspace();
      const sourcePath = join(ctx.tmpDir, "lib-shared");
      mkdirSync(sourcePath, { recursive: true });

      const sm = makeManager(
        workspace,
        configWithProjectSiblings(["lib-shared", "does-not-exist"]),
      );
      // SKIP + WARN + SURFACE: the spawn no longer bricks on the bad sibling.
      const session = await sm.spawn({ projectId: "my-app" });

      // The valid sibling still mounts; the unresolvable one is skipped.
      expect(session.siblings.map((s) => s.repo)).toEqual(["lib-shared"]);

      // Session is fully spawned and persisted — no rollback happened.
      expect(readMetadataRaw(sessionsDir, session.id)).not.toBeNull();
      expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
      const worktreeDir = getProjectWorktreesDir("my-app");
      expect(existsSync(join(worktreeDir, `${session.id}__sib__lib-shared`))).toBe(true);
    });

    it("records a prominent warning naming the skipped sibling (surfaced to dashboard / ao status)", async () => {
      const workspace = pathAwareWorkspace();
      mkdirSync(join(ctx.tmpDir, "lib-shared"), { recursive: true });

      const sm = makeManager(
        workspace,
        configWithProjectSiblings(["lib-shared", "does-not-exist"]),
      );
      const session = await sm.spawn({ projectId: "my-app" });

      const warnings = queryActivityEvents({
        projectId: "my-app",
        kind: "session.sibling_unresolved",
      });
      expect(warnings).toHaveLength(1);
      const event = warnings[0]!;
      expect(event.level).toBe("warn");
      expect(event.sessionId).toBe(session.id);
      // The offending sibling is named in both the summary and structured data.
      expect(event.summary).toContain("does-not-exist");
      expect(JSON.parse(event.data ?? "{}")).toMatchObject({ sibling: "does-not-exist" });
    });

    it("proceeds with NO siblings (and no warning) when the only configured sibling is unresolvable", async () => {
      const workspace = pathAwareWorkspace();

      const sm = makeManager(workspace, configWithProjectSiblings(["does-not-exist"]));
      const session = await sm.spawn({ projectId: "my-app" });

      expect(session.siblings).toEqual([]);
      expect(session.assembledViewPath).toBeNull();
      expect(ctx.mockRuntime.destroy).not.toHaveBeenCalled();
      expect(
        queryActivityEvents({ projectId: "my-app", kind: "session.sibling_unresolved" }),
      ).toHaveLength(1);
    });

    it("skips self-reference entries (by project id and by repo)", async () => {
      const workspace = pathAwareWorkspace();
      mkdirSync(join(ctx.tmpDir, "lib-shared"), { recursive: true });

      const sm = makeManager(
        workspace,
        configWithProjectSiblings(["my-app", "org/my-app", "lib-shared"]),
      );
      const session = await sm.spawn({ projectId: "my-app" });

      expect(session.siblings.map((s) => s.repo)).toEqual(["lib-shared"]);
    });

    it("creates no view or mounts when the configured list is self-only", async () => {
      const workspace = pathAwareWorkspace();

      const sm = makeManager(workspace, configWithProjectSiblings(["my-app"]));
      const session = await sm.spawn({ projectId: "my-app" });

      expect(session.siblings).toEqual([]);
      expect(session.assembledViewPath).toBeNull();
      expect(existsSync(assembledViewDir(getProjectWorktreesDir("my-app"), session.id))).toBe(
        false,
      );
    });

    it("spawns exactly as before when the project has no siblings configured", async () => {
      const workspace = pathAwareWorkspace();

      const sm = makeManager(workspace, configWithSibling());
      const session = await sm.spawn({ projectId: "my-app" });

      expect(session.siblings).toEqual([]);
      expect(session.assembledViewPath).toBeNull();
      expect(existsSync(assembledViewDir(getProjectWorktreesDir("my-app"), session.id))).toBe(
        false,
      );
      const raw = readMetadataRaw(sessionsDir, session.id);
      expect(raw?.["siblings"]).toBeUndefined();
      expect(raw?.["assembledView"]).toBeUndefined();
    });

    it("treats an empty siblings array the same as no siblings", async () => {
      const workspace = pathAwareWorkspace();

      const sm = makeManager(workspace, configWithProjectSiblings([]));
      const session = await sm.spawn({ projectId: "my-app" });

      expect(session.siblings).toEqual([]);
      expect(session.assembledViewPath).toBeNull();
      expect(existsSync(assembledViewDir(getProjectWorktreesDir("my-app"), session.id))).toBe(
        false,
      );
    });

    it("kill cleans up auto-mounted sibling symlinks and the view", async () => {
      const workspace = pathAwareWorkspace();
      mkdirSync(join(ctx.tmpDir, "lib-shared"), { recursive: true });

      const sm = makeManager(workspace, configWithProjectSiblings(["lib-shared"]));
      const session = await sm.spawn({ projectId: "my-app" });
      const ref = session.siblings[0]!;
      expect(existsSync(ref.path)).toBe(true);

      await sm.kill(session.id);

      expect(existsSync(ref.path)).toBe(false);
      expect(existsSync(assembledViewDir(getProjectWorktreesDir("my-app"), session.id))).toBe(
        false,
      );
    });

    it("configure-then-spawn end to end: YAML config → loadConfig → spawn mounts the readonly sibling with working adjacency", async () => {
      // The same wrapped agent-orchestrator.yaml shape a user writes (and the
      // web PATCH /api/projects/[id] persists) — exercises the full chain:
      // YAML → loadConfig (Zod) → ProjectConfig.siblings → _spawnInner auto-mount.
      // JSON.stringify keeps Windows backslash paths valid YAML.
      writeFileSync(
        ctx.configPath,
        [
          "projects:",
          "  my-app:",
          `    path: ${JSON.stringify(join(ctx.tmpDir, "my-app"))}`,
          "    repo: org/my-app",
          "    defaultBranch: main",
          "    sessionPrefix: app",
          "    siblings:",
          "      - lib-shared",
          "  lib-shared:",
          `    path: ${JSON.stringify(join(ctx.tmpDir, "lib-shared"))}`,
          "    repo: org/lib-shared",
          "    defaultBranch: master",
          "",
        ].join("\n"),
      );
      const sourcePath = join(ctx.tmpDir, "lib-shared");
      mkdirSync(sourcePath, { recursive: true });
      writeFileSync(join(sourcePath, "MARKER.txt"), "hello");

      const loaded = loadConfig(ctx.configPath);
      expect(loaded.projects["my-app"]?.siblings).toEqual(["lib-shared"]);

      const workspace = pathAwareWorkspace();
      const sm = makeManager(workspace, loaded);
      const session = await sm.spawn({ projectId: "my-app" });

      // The returned session carries the mounted readonly ref…
      expect(session.siblings).toHaveLength(1);
      const ref = session.siblings[0]!;
      expect(ref.repo).toBe("lib-shared");
      expect(ref.mode).toBe("readonly-symlink");
      expect(lstatSync(ref.path).isSymbolicLink()).toBe(true);

      // …with a working ../{name} adjacency path from the assembled view…
      expect(session.assembledViewPath).toBeTruthy();
      const adjacent = join(session.assembledViewPath!, "..", "lib-shared");
      expect(realpathSync(adjacent)).toBe(realpathSync(sourcePath));
      expect(readFileSync(join(adjacent, "MARKER.txt"), "utf-8")).toBe("hello");

      // …persisted in the session metadata.
      const raw = readMetadataRaw(sessionsDir, session.id);
      expect(parseSiblings(raw!)).toEqual([ref]);
    });

    it("restore does not re-mount configured siblings (no double-mount)", async () => {
      const workspace = pathAwareWorkspace();
      mkdirSync(join(ctx.tmpDir, "lib-shared"), { recursive: true });
      const worktreeDir = getProjectWorktreesDir("my-app");
      const wsPath = join(worktreeDir, "app-1");
      mkdirSync(wsPath, { recursive: true });
      const ref = {
        repo: "lib-shared",
        path: join(worktreeDir, "app-1__sib__lib-shared"),
        branch: "master",
        mode: "readonly-symlink" as const,
      };
      writeMetadata(sessionsDir, "app-1", {
        worktree: wsPath,
        branch: "feat/work",
        status: "killed",
        project: "my-app",
        runtimeHandle: makeHandle("rt-old"),
      });
      updateMetadata(sessionsDir, "app-1", { siblings: serializeSiblings([ref]) });

      const sm = makeManager(workspace, configWithProjectSiblings(["lib-shared"]));
      const restored = await sm.restore("app-1");

      // The metadata-carried ref is preserved exactly once — restore performs
      // no mounting, so the (killed) symlink is not re-created.
      expect(restored.siblings).toEqual([ref]);
      expect(parseSiblings(readMetadataRaw(sessionsDir, "app-1")!)).toEqual([ref]);
      expect(existsSync(ref.path)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Global-catalog resolution (root-cause fix)
//
// Spawn-time sibling resolution must consult the GLOBAL registered-projects
// catalog (~/.agent-orchestrator/config.yaml) — the same source the web
// sidebar offers siblings from — not just the config the running AO was loaded
// with. Otherwise a globally-registered sibling (e.g. taskmaster) added via the
// sidebar fails to resolve when AO was started from a single-project local
// config. setupTestContext points HOME at a tmp dir, so getGlobalConfigPath()
// resolves under ctx.tmpDir and we can plant a global config there.
// ---------------------------------------------------------------------------
describe("sibling resolution against the global registered-projects catalog", () => {
  /**
   * Write a global config at ~/.agent-orchestrator/config.yaml registering the
   * given projects, each under {tmpDir}/{id}. Mirrors the canonical global
   * config shape (defaults + projects with object-form repo identity).
   */
  function writeGlobalConfig(ids: string[]): void {
    const globalDir = join(ctx.tmpDir, ".agent-orchestrator");
    mkdirSync(globalDir, { recursive: true });
    const projectBlocks = ids
      .map((id) =>
        [
          `  ${id}:`,
          `    path: ${join(ctx.tmpDir, id)}`,
          `    defaultBranch: main`,
          `    repo:`,
          `      owner: org`,
          `      name: ${id}`,
          `      platform: github`,
          `      originUrl: https://github.com/org/${id}`,
        ].join("\n"),
      )
      .join("\n");
    const yaml = [
      `defaults:`,
      `  runtime: mock`,
      `  agent: mock-agent`,
      `  workspace: mock-ws`,
      `  notifiers: [desktop]`,
      `projects:`,
      projectBlocks,
      ``,
    ].join("\n");
    writeFileSync(join(globalDir, "config.yaml"), yaml);
  }

  /** Workspace mock that materializes worktrees on disk (see pathAwareWorkspace). */
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

  /** A single-project running config — only "my-app" is locally known. */
  function localOnlyConfig(): OrchestratorConfig {
    return { ...config, projects: { ...config.projects } };
  }

  function makeManager(workspace: Workspace, cfg: OrchestratorConfig) {
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

  it("resolves a sibling registered only in the global catalog (not in config.projects)", async () => {
    // taskmaster is globally registered but absent from the running config.
    writeGlobalConfig(["my-app", "taskmaster"]);
    mkdirSync(join(ctx.tmpDir, "taskmaster"), { recursive: true });
    writeWorker("app-1");

    const sm = makeManager(pathAwareWorkspace(), localOnlyConfig());
    const ref = await sm.addSibling("app-1", "taskmaster", { mode: "readonly-symlink" });

    expect(ref.repo).toBe("taskmaster");
    expect(ref.mode).toBe("readonly-symlink");
    // The mounted symlink targets the globally-registered project's path.
    expect(realpathSync(ref.path)).toBe(realpathSync(join(ctx.tmpDir, "taskmaster")));
  });

  it("resolves a globally-registered sibling by owner/name repo string", async () => {
    writeGlobalConfig(["my-app", "taskmaster"]);
    mkdirSync(join(ctx.tmpDir, "taskmaster"), { recursive: true });
    writeWorker("app-1");

    const sm = makeManager(pathAwareWorkspace(), localOnlyConfig());
    const ref = await sm.addSibling("app-1", "org/taskmaster", { mode: "readonly-symlink" });

    // Resolved id is the registered project id, not the owner/name string.
    expect(ref.repo).toBe("taskmaster");
  });

  it("still resolves a sibling present in the local config (local wins)", async () => {
    // Local config carries lib-shared; the global config does not list it.
    writeGlobalConfig(["my-app"]);
    const sourcePath = join(ctx.tmpDir, "lib-shared");
    mkdirSync(sourcePath, { recursive: true });
    writeWorker("app-1");

    const cfg: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "lib-shared": {
          name: "Lib Shared",
          repo: "org/lib-shared",
          path: sourcePath,
          defaultBranch: "master",
          sessionPrefix: "lib",
        },
      },
    };
    const sm = makeManager(pathAwareWorkspace(), cfg);
    const ref = await sm.addSibling("app-1", "lib-shared", { mode: "readonly-symlink" });
    expect(ref.repo).toBe("lib-shared");
  });

  it("falls back to config.projects when the global config is absent", async () => {
    // No global config written; lib-shared lives only in the running config.
    const sourcePath = join(ctx.tmpDir, "lib-shared");
    mkdirSync(sourcePath, { recursive: true });
    writeWorker("app-1");

    const cfg: OrchestratorConfig = {
      ...config,
      projects: {
        ...config.projects,
        "lib-shared": {
          name: "Lib Shared",
          repo: "org/lib-shared",
          path: sourcePath,
          defaultBranch: "master",
          sessionPrefix: "lib",
        },
      },
    };
    const sm = makeManager(pathAwareWorkspace(), cfg);
    const ref = await sm.addSibling("app-1", "lib-shared", { mode: "readonly-symlink" });
    expect(ref.repo).toBe("lib-shared");
  });

  it("still throws for a sibling in neither the local config nor the global catalog", async () => {
    writeGlobalConfig(["my-app", "taskmaster"]);
    writeWorker("app-1");

    const sm = makeManager(pathAwareWorkspace(), localOnlyConfig());
    await expect(
      sm.addSibling("app-1", "does-not-exist", { mode: "readonly-symlink" }),
    ).rejects.toThrow(/unknown sibling/i);
  });

  // Single-source-of-truth guard (add-time ↔ spawn-time alignment): a project
  // registered through the canonical registration path — the same
  // registerProjectInGlobalConfig the web sidebar/CLI use to register a
  // project — must be resolvable by the core spawn path, even though it is
  // absent from the running single-project config. If add-time and spawn-time
  // ever diverged on catalog or matching rule, this would fail.
  it("resolves a sibling registered via registerProjectInGlobalConfig (as the sidebar does)", async () => {
    const taskmasterPath = join(ctx.tmpDir, "taskmaster");
    mkdirSync(taskmasterPath, { recursive: true });
    const tmId = registerProjectInGlobalConfig("taskmaster", "Taskmaster", taskmasterPath);
    writeWorker("app-1");

    const sm = makeManager(pathAwareWorkspace(), localOnlyConfig());
    const ref = await sm.addSibling("app-1", tmId, { mode: "readonly-symlink" });

    expect(ref.repo).toBe(tmId);
    expect(realpathSync(ref.path)).toBe(realpathSync(taskmasterPath));
  });
});
