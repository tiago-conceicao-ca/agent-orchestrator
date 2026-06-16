import type { SdlcModel } from "../plan/types.js";
import type { GateVerdict, LensIssue } from "./types.js";

/**
 * Post-implementation gate pipeline, modelled on taskmaster's `risk_review_gate`
 * + `gates` (workflow_config.yaml): after a task's terminal impl pass, run the
 * risk lenses IN PARALLEL over the final diff, a SYNTHESIS step that waits for
 * all and consolidates, a TRIAGE step that opens bounded fix tasks for confirmed
 * issues, then the sequential build/test/lint QUALITY gates.
 */

/** A risk-review lens (taskmaster core `risk_lenses`, all opus). */
export interface RiskLensDef {
  key: string;
  template: string;
  model: SdlcModel;
}

/**
 * The core risk lenses (taskmaster `active_lens_tags: [core]`). A curated,
 * always-on subset; enterprise/tm-specific lenses are out of scope here.
 */
export const CORE_RISK_LENSES: RiskLensDef[] = [
  { key: "safety_correctness", template: "risk-lens-safety-correctness", model: "opus" },
  { key: "security", template: "risk-lens-security", model: "opus" },
  { key: "test_integrity", template: "risk-lens-test-integrity", model: "opus" },
  { key: "maintainability_design", template: "risk-lens-maintainability-design", model: "opus" },
];

/** Sequential quality gates run after triage (taskmaster `gates`). */
export const QUALITY_GATES = ["build", "test", "lint"] as const;
export type QualityGate = (typeof QUALITY_GATES)[number];

/** Default bound on triage-opened fix tasks (keeps the loop terminating). */
export const DEFAULT_MAX_FIX_TASKS = 3;

export interface TriageFixTask {
  title: string;
  issue: LensIssue;
}

export interface TriageResult {
  fixTasks: TriageFixTask[];
}

export interface QualityGateResult {
  gate: QualityGate;
  passed: boolean;
  detail?: string;
}

export interface GatePipelineResult {
  riskVerdicts: GateVerdict[];
  synthesis: GateVerdict;
  triage: TriageResult;
  qualityResults: QualityGateResult[];
}

export interface GatePipelineDeps {
  /** Run one risk lens over the final diff; called in parallel for all lenses. */
  runRiskLens: (lens: RiskLensDef, artifactRef: string) => Promise<GateVerdict>;
  /** Consolidate the parallel risk verdicts into one synthesis verdict. */
  synthesize: (verdicts: GateVerdict[], artifactRef: string) => Promise<GateVerdict>;
  /** Turn the synthesis into a (to-be-bounded) set of fix tasks. */
  triage: (synthesis: GateVerdict, artifactRef: string) => Promise<TriageResult>;
  /** Run one build/test/lint quality gate; `passed:false` fails the task. */
  runQualityGate: (gate: QualityGate, artifactRef: string) => Promise<{ passed: boolean; detail?: string }>;
  /** Bound on triage fix tasks; defaults to {@link DEFAULT_MAX_FIX_TASKS}. */
  maxFixTasks?: number;
  /** Optional sink to record each gate verdict on the run. */
  recordVerdict?: (verdict: GateVerdict) => Promise<void>;
  /** Optional progress logger. */
  log?: (msg: string) => void;
}

/**
 * Run the post-impl gate pipeline over a task's final diff (`artifactRef`).
 * Order: risk lenses (parallel) → synthesis (barrier) → triage (bounded) →
 * quality gates (sequential). A failing quality gate throws with a clear error
 * (the caller fails the task). Risk verdicts + synthesis are recorded.
 */
export async function runGatePipeline(
  deps: GatePipelineDeps,
  artifactRef: string,
): Promise<GatePipelineResult> {
  // 1. Risk lenses run IN PARALLEL over the final diff.
  const riskVerdicts = await Promise.all(
    CORE_RISK_LENSES.map((lens) => deps.runRiskLens(lens, artifactRef)),
  );
  for (const v of riskVerdicts) await deps.recordVerdict?.(v);

  // 2. SYNTHESIS waits for all risk lenses and consolidates.
  const synthesis = await deps.synthesize(riskVerdicts, artifactRef);
  await deps.recordVerdict?.(synthesis);

  // 3. TRIAGE opens fix tasks for confirmed issues, BOUNDED.
  const raw = await deps.triage(synthesis, artifactRef);
  const max = Math.max(0, deps.maxFixTasks ?? DEFAULT_MAX_FIX_TASKS);
  const triage: TriageResult = { fixTasks: raw.fixTasks.slice(0, max) };
  if (raw.fixTasks.length > max) {
    deps.log?.(`Triage produced ${raw.fixTasks.length} fix tasks; capping at ${max}.`);
  }

  // 4. QUALITY gates run SEQUENTIALLY after triage; first failure fails the task.
  const qualityResults: QualityGateResult[] = [];
  for (const gate of QUALITY_GATES) {
    const r = await deps.runQualityGate(gate, artifactRef);
    qualityResults.push({ gate, passed: r.passed, detail: r.detail });
    if (!r.passed) {
      throw new Error(`Quality gate '${gate}' failed: ${r.detail ?? "no detail provided"}`);
    }
  }

  return { riskVerdicts, synthesis, triage, qualityResults };
}
