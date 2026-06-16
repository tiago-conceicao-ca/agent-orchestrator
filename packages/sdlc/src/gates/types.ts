import type { RunContext } from "../workflow/types.js";

export type Severity = "high" | "medium" | "low";

export interface LensIssue {
  severity: Severity;
  title: string;
  detail: string;
}

export interface GateVerdict {
  type: "gate";
  lens: string;
  issues: LensIssue[];
  verdict: "pass" | "needs_fixes";
  /**
   * The lens agent's raw output (reasoning + the structured verdict it emitted).
   * Captured by `makeLensGate` so the run view can surface the agent's reasoning;
   * the engine persists it via `run.verdicts`. Optional — `parseLensVerdict`
   * tolerates its absence (e.g. for synthetic skip-lens verdicts).
   */
  rawOutput?: string;
}

export interface Gate {
  readonly name: string;
  /**
   * @param artifactRef path/handle to the phase output;
   * @param lens the lens key;
   * @param ctx the run position, so a session-backed runner can tag its session.
   */
  evaluate(artifactRef: string, lens: string, ctx: RunContext): Promise<GateVerdict>;
}

/** Parse a tm-style lens JSON blob emitted by an agent into a GateVerdict. */
export function parseLensVerdict(raw: string, lens: string): GateVerdict {
  const obj = JSON.parse(raw) as Partial<GateVerdict>;
  if (obj.verdict !== "pass" && obj.verdict !== "needs_fixes")
    throw new Error(`Lens '${lens}' returned an invalid verdict: ${String(obj.verdict)}`);
  return {
    type: "gate",
    lens,
    issues: Array.isArray(obj.issues) ? (obj.issues as LensIssue[]) : [],
    verdict: obj.verdict,
  };
}
