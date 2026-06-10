import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Entries that don't count as "generated output". */
const IGNORED = new Set([".git", "node_modules", ".ao", ".DS_Store"]);

/** True if `dir` contains at least one non-ignored regular file (recursively). */
function hasGeneratedFiles(dir: string): boolean {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false; // missing / unreadable
  }
  for (const e of entries) {
    if (IGNORED.has(e.name)) continue;
    if (e.isFile()) return true;
    if (e.isDirectory() && hasGeneratedFiles(join(dir, e.name))) return true;
  }
  return false;
}

/**
 * Lenient smoke eval (an `EvalCommandRunner` for the pattern-library gate). Passes
 * only if at least one generated worktree path contains produced files; a session
 * that halted early (e.g. a generator's workspace-prerequisite gate) or wrote
 * nothing leaves an empty path → needs_fixes WITH a finding, so the engine fails
 * the run cleanly (no hang, no stuck-running). The real ContaAzul `/avaliar-artefato`
 * eval is swappable behind the same injected `EvalCommandRunner`.
 *
 * @param artifactRef newline-separated absolute worktree path(s) from generate-backend.
 */
export async function smokeEvalArtifact(artifactRef: string): Promise<string> {
  const paths = artifactRef
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean);
  const produced = paths.filter((p) => hasGeneratedFiles(p));
  const passed = produced.length > 0;
  const findings = passed
    ? []
    : [
        {
          severity: "high",
          title: "No backend output produced",
          detail: `generate-backend produced no files in: ${
            (paths.length ? paths : ["(no artifact path)"]).join(", ")
          }. The session may have halted early (e.g. a workspace prerequisite gate) or written nothing.`,
        },
      ];
  return JSON.stringify({ passed, score: passed ? 1 : 0, findings });
}
