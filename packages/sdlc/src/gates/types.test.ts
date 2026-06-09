import { describe, it, expect } from "vitest";
import { parseLensVerdict, type Gate, type GateVerdict } from "./types";

describe("gate types", () => {
  it("a gate verdict mirrors tm's lens JSON shape", () => {
    const v: GateVerdict = {
      type: "gate",
      lens: "tactical",
      issues: [{ severity: "high", title: "t", detail: "d" }],
      verdict: "needs_fixes",
    };
    expect(v.verdict).toBe("needs_fixes");
  });
  it("a Gate evaluates an artifact ref to a verdict", async () => {
    const g: Gate = {
      name: "noop",
      evaluate: async () => ({ type: "gate", lens: "noop", issues: [], verdict: "pass" }),
    };
    expect((await g.evaluate("ref", "noop")).verdict).toBe("pass");
  });
  it("parseLensVerdict reads a tm-style lens JSON blob", () => {
    const v = parseLensVerdict('{"verdict":"pass","issues":[]}', "tactical");
    expect(v).toMatchObject({ type: "gate", lens: "tactical", verdict: "pass", issues: [] });
  });
  it("parseLensVerdict throws on an invalid verdict", () => {
    expect(() => parseLensVerdict('{"verdict":"maybe"}', "tactical")).toThrow(/invalid verdict/i);
  });
});
