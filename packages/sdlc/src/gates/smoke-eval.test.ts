import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { smokeEvalArtifact } from "./smoke-eval";

describe("smokeEvalArtifact", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "smoke-"));
  });

  it("passes when the worktree contains generated files", async () => {
    writeFileSync(join(dir, "users.js"), "module.exports = {};");
    const out = JSON.parse(await smokeEvalArtifact(dir));
    expect(out.passed).toBe(true);
    expect(out.findings).toEqual([]);
  });

  it("finds files nested below ignored dirs", async () => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "store.js"), "x");
    const out = JSON.parse(await smokeEvalArtifact(dir));
    expect(out.passed).toBe(true);
  });

  it("needs_fixes (with a finding) when the worktree has no generated files", async () => {
    // only ignored entries → counts as "produced nothing"
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main");
    const out = JSON.parse(await smokeEvalArtifact(dir));
    expect(out.passed).toBe(false);
    expect(out.findings[0].title).toMatch(/no .*output/i);
  });

  it("needs_fixes when the artifact path does not exist", async () => {
    const out = JSON.parse(await smokeEvalArtifact(join(dir, "missing")));
    expect(out.passed).toBe(false);
  });

  it("passes when ANY of several newline-joined paths produced files", async () => {
    const other = mkdtempSync(join(tmpdir(), "smoke-"));
    writeFileSync(join(other, "out.txt"), "x");
    const out = JSON.parse(await smokeEvalArtifact(`${dir}\n${other}`));
    expect(out.passed).toBe(true);
  });
});
