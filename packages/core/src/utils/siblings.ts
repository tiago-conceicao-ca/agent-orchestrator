import { lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { SiblingRef, SiblingMode } from "../types.js";
import { isWindows } from "../platform.js";
import { safeJsonParse } from "./validation.js";

/** Separator between the session id and the sibling name in an isolated worktree path. */
export const SIBLING_PATH_SEP = "__sib__";

/** Safe characters for a worktree directory segment (matches workspace-worktree's guard). */
const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/;

/**
 * Sibling repos (#1095) are persisted in the session metadata under a single
 * "siblings" key, mirroring how prs are metadata-backed (#1821). prs use a
 * comma-separated string because each entry is a single URL; a SiblingRef is a
 * structured record (repo/path/branch/mode), so it is JSON-encoded instead.
 *
 * Old sessions have no "siblings" key → parseSiblings returns []. Malformed or
 * partially-invalid metadata degrades gracefully: unparseable JSON yields [],
 * and individual entries missing required fields are dropped.
 */

const SIBLING_MODES: ReadonlySet<SiblingMode> = new Set<SiblingMode>([
  "worktree",
  "readonly-symlink",
]);

function isSiblingRef(value: unknown): value is SiblingRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["repo"] === "string" &&
    typeof candidate["path"] === "string" &&
    typeof candidate["branch"] === "string" &&
    typeof candidate["mode"] === "string" &&
    SIBLING_MODES.has(candidate["mode"] as SiblingMode)
  );
}

/** Parse the session's mounted siblings from metadata. Returns [] when absent/malformed. */
export function parseSiblings(meta: Record<string, string>): SiblingRef[] {
  const raw = meta["siblings"];
  if (!raw) return [];

  const parsed = safeJsonParse<unknown>(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed.filter(isSiblingRef).map((entry) => ({
    repo: entry.repo,
    path: entry.path,
    branch: entry.branch,
    mode: entry.mode,
  }));
}

/** Serialize siblings for the "siblings" metadata field. */
export function serializeSiblings(siblings: SiblingRef[]): string {
  return JSON.stringify(siblings);
}

/** The sibling's short name — the basename of its source repo path (used for adjacency + paths). */
export function siblingName(sourceRepoPath: string): string {
  return basename(sourceRepoPath.replace(/[/\\]+$/, ""));
}

/**
 * The isolated worktree directory segment for a sibling: `{sessionId}__sib__{name}`.
 * Embedding the session id guarantees two parallel sessions mounting the same
 * source repo get distinct paths (the #1095 collision). Validated against the
 * same safe-segment rule the workspace-worktree plugin enforces.
 */
export function siblingPathSegment(sessionId: string, name: string): string {
  const segment = `${sessionId}${SIBLING_PATH_SEP}${name}`;
  if (!SAFE_PATH_SEGMENT.test(segment)) {
    throw new Error(`Invalid sibling path segment "${segment}": must match ${SAFE_PATH_SEGMENT}`);
  }
  return segment;
}

/** Default per-session branch for a worktree-mode sibling (unique per session → no collision). */
export function defaultSiblingBranch(sessionId: string, name: string): string {
  return `sib/${sessionId}/${name}`;
}

/** Whether `target` currently exists as any filesystem entry (including a broken symlink). */
function pathExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a read-only adjacency symlink at `linkPath` pointing to the source repo.
 * Uses a junction on Windows (no admin/Developer Mode needed for directories).
 */
export function createReadonlySiblingLink(sourcePath: string, linkPath: string): void {
  if (pathExists(linkPath)) {
    rmSync(linkPath, { recursive: true, force: true });
  }
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(sourcePath, linkPath, isWindows() ? "junction" : "dir");
}

/** Best-effort removal of a sibling symlink/junction (and any stale dir at the path). */
export function removeSiblingLink(linkPath: string): void {
  if (!pathExists(linkPath)) return;
  rmSync(linkPath, { recursive: true, force: true });
}
