import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLensVerdict, type GateVerdict } from "../gates/types.js";

/**
 * Per-pass lens verdict sentinel. A review pass writes its `pass`/`needs_fixes`
 * verdict JSON here (in addition to the task-done sentinel) so the scheduler can
 * decide whether to AUTO re-dispatch the pass with the review feedback. Reuses
 * the same `.ao/<sentinel>.json` convention as the other SDLC sentinels.
 */
export const PASS_VERDICT_SENTINEL = "sdlc-pass-verdict.json";

const SENTINEL_DIR = ".ao";

/**
 * Instruction appended to a REVIEW pass prompt telling it to also write its lens
 * verdict to the pass-verdict sentinel as part of completing. The scheduler
 * reads this to gate auto re-dispatch on `needs_fixes`.
 */
export function passVerdictSentinelInstruction(): string {
  return (
    `In addition, write your verdict JSON object (the \`{"verdict":...,"issues":[...]}\` ` +
    `you produced) to \`.ao/${PASS_VERDICT_SENTINEL}\` in your current working directory ` +
    `(create the \`.ao\` directory if it does not exist). Write ONLY the verdict JSON.`
  );
}

/**
 * Read + parse a review pass's verdict sentinel from its shared worktree.
 * Returns `null` when the file is absent, empty, or unparseable — the scheduler
 * treats "no decisive verdict" as a pass (it never blocks on a missing file).
 * `lens` labels the returned verdict (e.g. `impl:<taskId>:<role>`).
 */
export function readPassVerdictSentinel(
  workspacePath: string | undefined,
  lens: string,
): GateVerdict | null {
  if (!workspacePath) return null;
  const path = join(workspacePath, SENTINEL_DIR, PASS_VERDICT_SENTINEL);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  if (raw.trim().length === 0) return null;
  try {
    const verdict = parseLensVerdict(raw, lens);
    const trimmed = raw.trim();
    return trimmed ? { ...verdict, rawOutput: trimmed } : verdict;
  } catch {
    return null;
  }
}
