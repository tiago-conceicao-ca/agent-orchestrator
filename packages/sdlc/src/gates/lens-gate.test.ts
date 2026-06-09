import { describe, it, expect } from "vitest";
import { loadLensPrompt, makeLensGate } from "./lens-gate";

describe("lens gate", () => {
  it("returns a pass verdict from the agent's JSON output", async () => {
    const runner = async () => '{"type":"plan_review","lens":"tactical","issues":[],"verdict":"pass"}';
    const gate = makeLensGate("tactical", "PROMPT", runner);
    const v = await gate.evaluate("plan.md", "tactical");
    expect(v.verdict).toBe("pass");
    expect(v.lens).toBe("tactical");
  });
  it("propagates needs_fixes and issues", async () => {
    const runner = async () =>
      '{"verdict":"needs_fixes","issues":[{"severity":"high","title":"t","detail":"d"}]}';
    const gate = makeLensGate("architectural", "PROMPT", runner);
    const v = await gate.evaluate("plan.md", "architectural");
    expect(v.verdict).toBe("needs_fixes");
    expect(v.issues[0].severity).toBe("high");
  });
  it("tolerates surrounding prose around the JSON blob", async () => {
    const runner = async () => 'Here is my review:\n{"verdict":"pass","issues":[]}\nDone.';
    const gate = makeLensGate("adversarial", "PROMPT", runner);
    expect((await gate.evaluate("plan.md", "adversarial")).verdict).toBe("pass");
  });
  it("ignores a stray brace in prose before the verdict", async () => {
    const runner = async () =>
      "Note: handle {curly} braces carefully.\nReview:\n{\"verdict\":\"pass\",\"issues\":[]}";
    const gate = makeLensGate("tactical", "PROMPT", runner);
    expect((await gate.evaluate("plan.md", "tactical")).verdict).toBe("pass");
  });
  it("returns the LAST JSON object when the agent echoes an earlier example", async () => {
    const runner = async () =>
      '{"verdict":"needs_fixes","issues":[{"severity":"high","title":"example","detail":"placeholder"}]}\n\n{"verdict":"pass","issues":[]}';
    const gate = makeLensGate("architectural", "PROMPT", runner);
    const v = await gate.evaluate("plan.md", "architectural");
    expect(v.verdict).toBe("pass");
    expect(v.issues).toEqual([]);
  });
  it("ignores a closing brace inside a JSON string value", async () => {
    const runner = async () =>
      '{"verdict":"needs_fixes","issues":[{"severity":"low","title":"t","detail":"use a } brace"}]}';
    const gate = makeLensGate("tactical", "PROMPT", runner);
    const v = await gate.evaluate("plan.md", "tactical");
    expect(v.verdict).toBe("needs_fixes");
    expect(v.issues[0].detail).toBe("use a } brace");
  });
  it("ignores an opening brace inside a JSON string value", async () => {
    const runner = async () =>
      '{"verdict":"pass","issues":[{"severity":"low","title":"t","detail":"an { brace"}]}';
    const gate = makeLensGate("tactical", "PROMPT", runner);
    const v = await gate.evaluate("plan.md", "tactical");
    expect(v.verdict).toBe("pass");
    expect(v.issues[0].detail).toBe("an { brace");
  });
  it("ignores an unmatched trailing brace in prose after the verdict", async () => {
    const runner = async () => '{"verdict":"pass","issues":[]}\n(end of review) }';
    const gate = makeLensGate("tactical", "PROMPT", runner);
    expect((await gate.evaluate("plan.md", "tactical")).verdict).toBe("pass");
  });
  it("handles an escaped quote inside a JSON string value", async () => {
    // The \" must NOT close the string, and the } inside it must be ignored —
    // so the whole object is captured and the detail round-trips intact.
    const runner = async () =>
      '{"verdict":"pass","issues":[{"severity":"low","title":"t","detail":"a \\" and a } inside"}]}';
    const gate = makeLensGate("tactical", "PROMPT", runner);
    const v = await gate.evaluate("plan.md", "tactical");
    expect(v.verdict).toBe("pass");
    expect(v.issues[0].detail).toBe('a " and a } inside');
  });
});

describe("loadLensPrompt", () => {
  it("loads the tactical prompt body with the {artifact} placeholder", () => {
    const p = loadLensPrompt("tactical");
    expect(p).toContain("Plan Review Tactical");
    expect(p).toContain("{artifact}");
  });
  it("loads each lens prompt", () => {
    for (const name of ["tactical", "architectural", "adversarial"] as const) {
      expect(loadLensPrompt(name).length).toBeGreaterThan(0);
    }
  });
});
