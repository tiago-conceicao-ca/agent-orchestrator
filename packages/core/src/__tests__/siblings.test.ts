import { describe, it, expect } from "vitest";
import { parseSiblings, serializeSiblings } from "../utils/siblings.js";
import type { SiblingRef } from "../types.js";

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
