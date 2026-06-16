import { describe, it, expect } from "vitest";
import {
  CORE_RISK_LENSES,
  DEFAULT_MAX_FIX_TASKS,
  QUALITY_GATES,
  runGatePipeline,
  type GatePipelineDeps,
  type QualityGate,
} from "./gate-pipeline";
import type { GateVerdict } from "./types";

function verdict(lens: string, v: "pass" | "needs_fixes" = "pass"): GateVerdict {
  return { type: "gate", lens, verdict: v, issues: v === "pass" ? [] : [{ severity: "high", title: "x", detail: "y" }] };
}

function deps(overrides: Partial<GatePipelineDeps> = {}): GatePipelineDeps {
  return {
    runRiskLens: async (lens) => verdict(lens.key),
    synthesize: async () => verdict("synthesis"),
    triage: async () => ({ fixTasks: [] }),
    runQualityGate: async () => ({ passed: true }),
    ...overrides,
  };
}

describe("runGatePipeline (risk → synthesis → triage → quality)", () => {
  it("runs all core risk lenses in parallel, then synthesis, then quality gates", async () => {
    const order: string[] = [];
    const result = await runGatePipeline(
      deps({
        runRiskLens: async (lens) => {
          order.push(`risk:${lens.key}`);
          return verdict(lens.key);
        },
        synthesize: async () => {
          order.push("synthesis");
          return verdict("synthesis");
        },
        triage: async () => {
          order.push("triage");
          return { fixTasks: [] };
        },
        runQualityGate: async (gate) => {
          order.push(`quality:${gate}`);
          return { passed: true };
        },
      }),
      "/wt/t",
    );

    expect(result.riskVerdicts).toHaveLength(CORE_RISK_LENSES.length);
    // synthesis comes after every risk lens; triage after synthesis; quality last.
    expect(order.indexOf("synthesis")).toBeGreaterThan(order.indexOf("risk:security"));
    expect(order.indexOf("triage")).toBeGreaterThan(order.indexOf("synthesis"));
    expect(order.indexOf("quality:build")).toBeGreaterThan(order.indexOf("triage"));
    // quality gates run in order build → test → lint.
    expect(QUALITY_GATES.map((g) => order.indexOf(`quality:${g}`))).toEqual(
      [...QUALITY_GATES].map((g) => order.indexOf(`quality:${g}`)).sort((a, b) => a - b),
    );
  });

  it("records each risk verdict and the synthesis verdict", async () => {
    const recorded: GateVerdict[] = [];
    await runGatePipeline(deps({ recordVerdict: async (v) => { recorded.push(v); } }), "/wt/t");
    expect(recorded).toHaveLength(CORE_RISK_LENSES.length + 1); // risks + synthesis
    expect(recorded.some((v) => v.lens === "synthesis")).toBe(true);
  });

  it("bounds the triage fix tasks to maxFixTasks", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      title: `Fix ${i}`,
      issue: { severity: "high" as const, title: `t${i}`, detail: "d" },
    }));
    const result = await runGatePipeline(
      deps({ triage: async () => ({ fixTasks: many }), maxFixTasks: 2 }),
      "/wt/t",
    );
    expect(result.triage.fixTasks).toHaveLength(2);
  });

  it("defaults the fix-task bound to DEFAULT_MAX_FIX_TASKS", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      title: `Fix ${i}`,
      issue: { severity: "high" as const, title: `t${i}`, detail: "d" },
    }));
    const result = await runGatePipeline(deps({ triage: async () => ({ fixTasks: many }) }), "/wt/t");
    expect(result.triage.fixTasks).toHaveLength(DEFAULT_MAX_FIX_TASKS);
  });

  it("throws with a clear error when a quality gate fails", async () => {
    const failing: QualityGate = "test";
    await expect(
      runGatePipeline(
        deps({
          runQualityGate: async (gate) =>
            gate === failing ? { passed: false, detail: "2 tests failed" } : { passed: true },
        }),
        "/wt/t",
      ),
    ).rejects.toThrow(/Quality gate 'test' failed: 2 tests failed/);
  });

  it("stops at the first failing quality gate (does not run later gates)", async () => {
    const ran: QualityGate[] = [];
    await expect(
      runGatePipeline(
        deps({
          runQualityGate: async (gate) => {
            ran.push(gate);
            return gate === "build" ? { passed: false, detail: "compile error" } : { passed: true };
          },
        }),
        "/wt/t",
      ),
    ).rejects.toThrow(/build/);
    expect(ran).toEqual(["build"]); // test/lint never reached
  });
});
