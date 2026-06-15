import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  parseSiblings,
  serializeSiblings,
  assembledViewDir,
  assembledPrimaryViewPath,
  siblingNameFromPath,
  resolveSiblingAdjacency,
  SIBLING_ASSEMBLED_SUFFIX,
} from "../utils/siblings.js";
import type { ProjectConfig, SiblingRef } from "../types.js";

describe("siblings metadata serialization (#1095, mirrors prs #1821)", () => {
  const sample: SiblingRef[] = [
    {
      repo: "ca-starters-front",
      path: "/home/u/.agent-orchestrator/projects/svc/worktrees/ao-10__sib__ca-starters-front",
      branch: "master",
      mode: "readonly-symlink",
    },
    {
      repo: "svc-infra",
      path: "/home/u/.agent-orchestrator/projects/svc/worktrees/ao-10__sib__svc-infra",
      branch: "sib/ao-10/svc-infra",
      mode: "worktree",
    },
  ];

  it("round-trips siblings through serialize → parse", () => {
    const meta = { siblings: serializeSiblings(sample) };
    expect(parseSiblings(meta)).toEqual(sample);
  });

  it("returns [] when the siblings field is absent (back-compat with old sessions)", () => {
    expect(parseSiblings({})).toEqual([]);
    expect(parseSiblings({ branch: "main", status: "working" })).toEqual([]);
  });

  it("returns [] for an empty siblings field", () => {
    expect(parseSiblings({ siblings: "" })).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseSiblings({ siblings: "{not json" })).toEqual([]);
  });

  it("returns [] when the parsed value is not an array", () => {
    expect(parseSiblings({ siblings: JSON.stringify({ repo: "x" }) })).toEqual([]);
  });

  it("drops entries with missing or invalid fields", () => {
    const meta = {
      siblings: JSON.stringify([
        { repo: "ok", path: "/p", branch: "b", mode: "worktree" },
        { repo: "bad-mode", path: "/p", branch: "b", mode: "nope" },
        { repo: "missing-path", branch: "b", mode: "worktree" },
        { repo: "ok2", path: "/p2", branch: "b2", mode: "readonly-symlink" },
        "not-an-object",
        null,
      ]),
    };
    expect(parseSiblings(meta)).toEqual([
      { repo: "ok", path: "/p", branch: "b", mode: "worktree" },
      { repo: "ok2", path: "/p2", branch: "b2", mode: "readonly-symlink" },
    ]);
  });

  it("serializes an empty list to an empty-array string", () => {
    expect(serializeSiblings([])).toBe("[]");
  });
});

describe("assembled adjacency view paths (#1095 Decision 3)", () => {
  const worktreeDir = "/home/u/.agent-orchestrator/projects/svc/worktrees";

  it("assembledViewDir is the per-session __ws dir", () => {
    expect(assembledViewDir(worktreeDir, "ao-10")).toBe(
      join(worktreeDir, `ao-10${SIBLING_ASSEMBLED_SUFFIX}`),
    );
    expect(SIBLING_ASSEMBLED_SUFFIX).toBe("__ws");
  });

  it("assembledPrimaryViewPath nests the primary repo name under __ws", () => {
    expect(assembledPrimaryViewPath(worktreeDir, "ao-10", "agent-orchestrator")).toBe(
      join(worktreeDir, "ao-10__ws", "agent-orchestrator"),
    );
  });

  it("two parallel sessions get distinct __ws dirs (no collision)", () => {
    expect(assembledViewDir(worktreeDir, "ao-10")).not.toBe(
      assembledViewDir(worktreeDir, "ao-11"),
    );
  });

  it("rejects an unsafe session id in the assembled-view segment", () => {
    expect(() => assembledViewDir(worktreeDir, "../evil")).toThrow(/invalid assembled-view/i);
  });

  it("siblingNameFromPath strips the {sessionId}__sib__ prefix to the real repo name", () => {
    const path = join(worktreeDir, "ao-10__sib__svc-infra");
    expect(siblingNameFromPath("ao-10", path)).toBe("svc-infra");
  });

  it("siblingNameFromPath returns null when the segment does not match the session prefix", () => {
    expect(siblingNameFromPath("ao-10", join(worktreeDir, "ao-11__sib__svc-infra"))).toBeNull();
    expect(siblingNameFromPath("ao-10", join(worktreeDir, "ao-10"))).toBeNull();
  });
});

describe("resolveSiblingAdjacency (shared resolver for all sibling renderers)", () => {
  function project(overrides: Partial<ProjectConfig> & Pick<ProjectConfig, "path">): ProjectConfig {
    return {
      name: "Project",
      defaultBranch: "main",
      sessionPrefix: "p",
      ...overrides,
    };
  }

  const projects: Record<string, ProjectConfig> = {
    svc: project({ name: "Service", repo: "org/svc", path: "/home/u/code/svc" }),
    front: project({ name: "Front End", repo: "org/ca-starters-front", path: "/home/u/code/ca-starters-front" }),
    infra: project({ name: "Infra", repo: "org/svc-infra", path: "/home/u/code/svc-infra/" }),
  };

  it("resolves entries by project id", () => {
    expect(resolveSiblingAdjacency(projects, ["front"], "svc")).toEqual([
      { repo: "front", name: "ca-starters-front", displayName: "Front End" },
    ]);
  });

  it("resolves entries by owner/name repo", () => {
    expect(resolveSiblingAdjacency(projects, ["org/svc-infra"], "svc")).toEqual([
      { repo: "infra", name: "svc-infra", displayName: "Infra" },
    ]);
  });

  it("derives the ../{name} adjacency from the resolved project's path basename, not the raw entry", () => {
    // "org/ca-starters-front" is the repo string; the adjacency name is the path basename.
    const [resolved] = resolveSiblingAdjacency(projects, ["org/ca-starters-front"], "svc");
    expect(resolved?.name).toBe("ca-starters-front");
  });

  it("skips the self-reference", () => {
    expect(resolveSiblingAdjacency(projects, ["svc", "front"], "svc")).toEqual([
      { repo: "front", name: "ca-starters-front", displayName: "Front End" },
    ]);
  });

  it("skips unknown / unresolvable entries", () => {
    expect(resolveSiblingAdjacency(projects, ["does-not-exist", "front"], "svc")).toEqual([
      { repo: "front", name: "ca-starters-front", displayName: "Front End" },
    ]);
  });

  it("de-duplicates entries that resolve to the same project", () => {
    expect(resolveSiblingAdjacency(projects, ["front", "org/ca-starters-front"], "svc")).toEqual([
      { repo: "front", name: "ca-starters-front", displayName: "Front End" },
    ]);
  });

  it("returns [] for an empty or undefined entry list", () => {
    expect(resolveSiblingAdjacency(projects, [], "svc")).toEqual([]);
    expect(resolveSiblingAdjacency(projects, undefined, "svc")).toEqual([]);
  });
});
