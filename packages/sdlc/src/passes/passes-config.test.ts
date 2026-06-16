import { describe, it, expect } from "vitest";
import {
  COMPLEXITY_PASSES,
  PASS_DEFS,
  PASS_ROLES,
  isReviewPass,
  passesForComplexity,
} from "./passes-config";

describe("passes-config (complexity → passes gating)", () => {
  it("LOW expands to 3 passes (initial + correctness + edge_cases)", () => {
    expect(passesForComplexity("LOW").map((p) => p.role)).toEqual([
      "initial",
      "correctness",
      "edge_cases",
    ]);
  });

  it("MEDIUM adds simplicity (4 passes)", () => {
    expect(passesForComplexity("MEDIUM").map((p) => p.role)).toEqual([
      "initial",
      "correctness",
      "edge_cases",
      "simplicity",
    ]);
  });

  it("HIGH adds production hardening (5 passes)", () => {
    expect(passesForComplexity("HIGH").map((p) => p.role)).toEqual([
      "initial",
      "correctness",
      "edge_cases",
      "simplicity",
      "excellence",
    ]);
  });

  it("gating is monotonic — each tier is a prefix-superset of the lower one", () => {
    const low = COMPLEXITY_PASSES.LOW;
    const med = COMPLEXITY_PASSES.MEDIUM;
    const high = COMPLEXITY_PASSES.HIGH;
    expect(med.slice(0, low.length)).toEqual(low);
    expect(high.slice(0, med.length)).toEqual(med);
  });

  it("the initial pass runs on sonnet; every review pass runs on opus", () => {
    expect(PASS_DEFS.initial.model).toBe("sonnet");
    for (const role of PASS_ROLES.filter((r) => r !== "initial")) {
      expect(PASS_DEFS[role].model).toBe("opus");
    }
  });

  it("each pass carries a distinct prompt template id", () => {
    const templates = PASS_ROLES.map((r) => PASS_DEFS[r].template);
    expect(new Set(templates).size).toBe(templates.length);
    expect(PASS_DEFS.correctness.template).toBe("implement-lens-correctness");
  });

  it("isReviewPass is false only for the initial pass", () => {
    expect(isReviewPass("initial")).toBe(false);
    expect(isReviewPass("correctness")).toBe(true);
    expect(isReviewPass("excellence")).toBe(true);
  });
});
