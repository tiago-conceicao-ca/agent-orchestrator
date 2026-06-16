import { describe, it, expect } from "vitest";
import { loadPromptTemplate } from "./lens-gate";
import { PASS_DEFS, PASS_ROLES } from "../passes/passes-config";

describe("implement-lens prompt templates", () => {
  it("every pass role has a loadable template carrying the {artifact} placeholder", () => {
    for (const role of PASS_ROLES) {
      const body = loadPromptTemplate(PASS_DEFS[role].template);
      expect(body.length).toBeGreaterThan(0);
      expect(body).toContain("{artifact}");
    }
  });

  it("review-pass templates instruct reading the PREVIOUS pass's work + emit a verdict contract", () => {
    for (const role of PASS_ROLES) {
      const body = loadPromptTemplate(PASS_DEFS[role].template);
      // Output contract compatible with parseLensVerdict (verdict + issues).
      expect(body).toMatch(/"verdict":"pass"/);
      expect(body).toContain('"verdict":"needs_fixes"');
      expect(body).toMatch(/"lens":"\w+"/);
      if (role !== "initial") {
        expect(body.toLowerCase()).toContain("previous pass");
      }
    }
  });

  it("the initial template instructs implementing the task", () => {
    const body = loadPromptTemplate(PASS_DEFS.initial.template).toLowerCase();
    expect(body).toContain("implement");
  });
});
