import { describe, it, expect } from "vitest";
import { SDLC_MODELS } from "@contaazul/cahi-sdlc";
import {
  SDLC_MODEL_OPTIONS,
  categorizeVerdict,
  gateVerdicts,
  passVerdictLens,
  type VerdictView,
} from "@/lib/sdlc-board";

describe("verdict categorization + gate grouping", () => {
  it("categorizes lens-pass, risk, synthesis, triage, and plan verdicts", () => {
    expect(categorizeVerdict("impl:epic__t:correctness")).toBe("pass");
    expect(categorizeVerdict("safety_correctness")).toBe("risk");
    expect(categorizeVerdict("synthesis")).toBe("synthesis");
    expect(categorizeVerdict("triage")).toBe("triage");
    expect(categorizeVerdict("tactical")).toBe("plan");
  });

  it("passVerdictLens builds the composite pass-verdict lens id", () => {
    expect(passVerdictLens("epic__t", "edge_cases")).toBe("impl:epic__t:edge_cases");
  });

  it("gateVerdicts surfaces only risk-review + synthesis verdicts", () => {
    const verdicts: VerdictView[] = [
      { lens: "tactical", verdict: "pass", issues: [], rawOutput: null },
      { lens: "impl:t:correctness", verdict: "pass", issues: [], rawOutput: null },
      { lens: "security", verdict: "needs_fixes", issues: [], rawOutput: null },
      { lens: "synthesis", verdict: "pass", issues: [], rawOutput: null },
    ];
    expect(gateVerdicts(verdicts).map((v) => v.lens)).toEqual(["security", "synthesis"]);
  });
});

describe("SDLC_MODEL_OPTIONS", () => {
  it("stays in sync with the source SDLC_MODELS constant", () => {
    // Client-safe mirror — drift would offer the modal a model the engine
    // doesn't accept (or hide one it does).
    expect([...SDLC_MODEL_OPTIONS]).toEqual([...SDLC_MODELS]);
  });
});
