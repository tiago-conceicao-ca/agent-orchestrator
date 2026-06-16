import type { WorkflowTask } from "../plan/types.js";
import { loadPromptTemplate } from "../gates/lens-gate.js";
import { parseLensVerdict, type GateVerdict, type LensIssue } from "../gates/types.js";
import {
  runGatePipeline,
  type QualityGate,
  type TriageResult,
  type RiskLensDef,
} from "../gates/gate-pipeline.js";
import { runSessionBackedAgent, type SdlcSessionSpawn } from "./session-runner.js";

/**
 * A runner that drives one risk/synthesis/triage agent over an artifact and
 * returns its raw text. `runId` tags the spawned session; `role` labels the
 * phase (e.g. `risk:security`). The session-backed impl spawns a real worker; a
 * headless impl can run `claude -p`.
 */
export type GateAgentRunner = (prompt: string, role: string, runId: string) => Promise<string>;

/**
 * Quality-gate command runner: returns the gate's pass/fail + detail. Wirings
 * supply a project-appropriate impl (e.g. the smoke eval, or build/test/lint).
 */
export type QualityGateRunner = (
  gate: QualityGate,
  artifactRef: string,
) => Promise<{ passed: boolean; detail?: string }>;

/** Render the risk findings into a synthesis/triage prompt addendum. */
function renderFindings(verdicts: GateVerdict[]): string {
  const lines: string[] = [];
  for (const v of verdicts) {
    for (const i of v.issues) lines.push(`- [${v.lens}/${i.severity}] ${i.title}: ${i.detail}`);
  }
  return lines.length ? lines.join("\n") : "(no issues reported)";
}

/** Best-effort parse of the triage agent's `{"fixTasks":[...]}` output. */
function parseTriage(raw: string): TriageResult {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { fixTasks: [] };
    const obj = JSON.parse(match[0]) as { fixTasks?: unknown };
    if (!Array.isArray(obj.fixTasks)) return { fixTasks: [] };
    const fixTasks = obj.fixTasks
      .filter((t): t is { title: string; issue: LensIssue } =>
        typeof t === "object" && t !== null && typeof (t as { title?: unknown }).title === "string",
      )
      .map((t) => ({ title: t.title, issue: t.issue }));
    return { fixTasks };
  } catch {
    return { fixTasks: [] };
  }
}

/**
 * Build the `runTaskGates` seam for `makeGenerateBackendExecutor` from a gate
 * agent runner + quality runner. Risk lenses run in parallel, synthesis + triage
 * run as agents that read the prior findings, and quality gates run via the
 * supplied command runner — all over the task's shared worktree (`artifactRef`).
 */
export function makeGatePipelineRunner(
  runAgent: GateAgentRunner,
  runQualityGate: QualityGateRunner,
  opts: { maxFixTasks?: number } = {},
): (
  task: WorkflowTask,
  artifactRef: string,
  hooks: { runId: string; recordVerdict?: (v: GateVerdict) => Promise<void>; log: (m: string) => void },
) => Promise<void> {
  return async (task, artifactRef, hooks) => {
    const runId = hooks.runId;
    const runRiskLens = async (lens: RiskLensDef): Promise<GateVerdict> => {
      const prompt = loadPromptTemplate(lens.template).replace("{artifact}", artifactRef);
      const raw = await runAgent(prompt, `risk:${lens.key}`, runId);
      return parseLensVerdict(extractJson(raw), lens.key);
    };
    const synthesize = async (verdicts: GateVerdict[]): Promise<GateVerdict> => {
      const prompt =
        loadPromptTemplate("risk-review-synthesis").replace("{artifact}", artifactRef) +
        `\n\n## Risk-lens findings\n\n${renderFindings(verdicts)}`;
      const raw = await runAgent(prompt, "risk:synthesis", runId);
      return parseLensVerdict(extractJson(raw), "synthesis");
    };
    const triage = async (synthesis: GateVerdict): Promise<TriageResult> => {
      const prompt =
        loadPromptTemplate("risk-review-triage").replace("{artifact}", artifactRef) +
        `\n\n## Synthesis findings\n\n${renderFindings([synthesis])}`;
      const raw = await runAgent(prompt, "risk:triage", runId);
      return parseTriage(raw);
    };

    await runGatePipeline(
      {
        runRiskLens,
        synthesize,
        triage,
        runQualityGate: (gate) => runQualityGate(gate, artifactRef),
        maxFixTasks: opts.maxFixTasks,
        recordVerdict: hooks.recordVerdict,
        log: hooks.log,
      },
      artifactRef,
    );
  };
}

/** Extract the last balanced top-level JSON object from agent prose. */
function extractJson(text: string): string {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  const objects: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  if (objects.length === 0) throw new Error("No JSON verdict found in gate agent output.");
  return objects[objects.length - 1]!;
}

/**
 * Convenience: build a {@link GateAgentRunner} backed by a real AO worker session
 * (reusing the #6 session runner + lens sentinel). Each gate agent writes its
 * verdict JSON to the lens sentinel, which this reads back.
 */
export function makeSessionGateAgentRunner(
  sm: SdlcSessionSpawn,
  timeoutMs?: number,
): GateAgentRunner {
  const LENS_OUTPUT_INSTRUCTION =
    `\n\n---\nWhen finished, your FINAL action MUST be to write ONLY your verdict JSON object ` +
    `to \`.ao/sdlc-output.json\` in your current working directory (create \`.ao\` if needed).`;
  return (prompt, role, runId) =>
    runSessionBackedAgent(sm, {
      prompt: prompt + LENS_OUTPUT_INSTRUCTION,
      sentinelName: "sdlc-output.json",
      runId,
      phase: role,
      role: "lens",
      timeoutMs,
    });
}
