import { describe, it, expect } from "vitest";
import { makePatternLibraryGate } from "./pattern-library-gate";

describe("pattern-library gate", () => {
  it("maps a passing eval-runner result to pass", async () => {
    const cmd = async () => JSON.stringify({ passed: true, score: 0.95, findings: [] });
    const gate = makePatternLibraryGate(cmd);
    const v = await gate.evaluate("/path/to/backend", "backend-eval");
    expect(v.verdict).toBe("pass");
  });
  it("maps a failing eval-runner result to needs_fixes with issues", async () => {
    const cmd = async () =>
      JSON.stringify({
        passed: false,
        score: 0.4,
        findings: [{ severity: "high", title: "missing test", detail: "no unit test" }],
      });
    const gate = makePatternLibraryGate(cmd);
    const v = await gate.evaluate("/path/to/backend", "backend-eval");
    expect(v.verdict).toBe("needs_fixes");
    expect(v.issues[0].title).toBe("missing test");
  });
});
