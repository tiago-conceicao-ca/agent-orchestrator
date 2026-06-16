import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PASS_VERDICT_SENTINEL, readPassVerdictSentinel } from "./pass-verdict";

describe("readPassVerdictSentinel", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pass-verdict-"));
    mkdirSync(join(dir, ".cahi"), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (content: string) =>
    writeFileSync(join(dir, ".cahi", PASS_VERDICT_SENTINEL), content, "utf-8");

  it("parses a pass verdict and labels it with the given lens", () => {
    write('{"verdict":"pass","issues":[]}');
    const v = readPassVerdictSentinel(dir, "impl:t:correctness");
    expect(v).toMatchObject({ verdict: "pass", lens: "impl:t:correctness", issues: [] });
  });

  it("parses a needs_fixes verdict with issues and captures rawOutput", () => {
    write('{"verdict":"needs_fixes","issues":[{"severity":"high","title":"x","detail":"y"}]}');
    const v = readPassVerdictSentinel(dir, "impl:t:edge_cases");
    expect(v?.verdict).toBe("needs_fixes");
    expect(v?.issues).toHaveLength(1);
    expect(v?.rawOutput).toContain("needs_fixes");
  });

  it("returns null for a missing workspace / file (treated as a pass upstream)", () => {
    expect(readPassVerdictSentinel(undefined, "l")).toBeNull();
    expect(readPassVerdictSentinel(dir, "l")).toBeNull(); // file not written
  });

  it("returns null for an empty or unparseable sentinel", () => {
    write("   ");
    expect(readPassVerdictSentinel(dir, "l")).toBeNull();
    write("not json");
    expect(readPassVerdictSentinel(dir, "l")).toBeNull();
  });
});
