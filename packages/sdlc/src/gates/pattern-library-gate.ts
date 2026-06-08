import { type Gate, type GateVerdict, type LensIssue } from "./types.js";

/** Runs the pattern-library eval-runner over an artifact dir, returning its raw JSON. */
export type EvalCommandRunner = (artifactRef: string) => Promise<string>;

interface EvalResult {
  passed: boolean;
  score: number;
  findings?: LensIssue[];
}

export function makePatternLibraryGate(run: EvalCommandRunner): Gate {
  return {
    name: "pattern-library",
    async evaluate(artifactRef: string, lens: string): Promise<GateVerdict> {
      const result = JSON.parse(await run(artifactRef)) as EvalResult;
      return {
        type: "gate",
        lens,
        issues: result.findings ?? [],
        verdict: result.passed ? "pass" : "needs_fixes",
      };
    },
  };
}
