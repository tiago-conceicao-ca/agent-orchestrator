import { lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ProjectConfig, SiblingRef, SiblingMode } from "../types.js";
import { isWindows } from "../platform.js";
import { safeJsonParse } from "./validation.js";

/** Separator between the session id and the sibling name in an isolated worktree path. */
export const SIBLING_PATH_SEP = "__sib__";

/** Suffix marking a session's assembled adjacency-view directory ({sessionId}__ws). */
export const SIBLING_ASSEMBLED_SUFFIX = "__ws";

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
 * Match a configured sibling entry (a registered project id OR "owner/name"
 * repo) to a registered project id, against the projects catalog. Returns the
 * matched project id, or null when nothing matches.
 *
 * This is the SINGLE matching rule shared by every consumer — spawn-time
 * resolution (resolveSiblingSource), adjacency rendering (resolveSiblingAdjacency),
 * the web sidebar's available-siblings list, and the PATCH /api/projects/[id]
 * validation. Sharing one rule against one catalog source is what guarantees the
 * UI can never offer a sibling that spawn would then fail to resolve.
 */
export function matchSiblingProjectId(
  entry: string,
  projects: Record<string, { repo?: string }>,
): string | null {
  for (const [id, proj] of Object.entries(projects)) {
    if (id === entry || proj.repo === entry) return id;
  }
  return null;
}

/** A configured sibling resolved against the projects catalog, for rendering. */
export interface SiblingAdjacency {
  /** The resolved project's registered id (mirrors SiblingRef.repo). */
  repo: string;
  /** The `../{name}` adjacency — basename of the resolved project's on-disk path. */
  name: string;
  /** The resolved project's display name. */
  displayName: string;
}

/**
 * Resolve a project's configured `siblings` entries to their adjacency view, so
 * every renderer (orchestrator prompt, worker prompt, `ao status`) agrees on the
 * names. Each entry is a registered project id or "owner/name" repo, matched via
 * the shared matchSiblingProjectId rule. Self-references, unresolvable entries,
 * and duplicates are skipped.
 *
 * Critical: the `../{name}` adjacency is `siblingName(resolvedProject.path)` (the
 * path basename), NOT the raw config string — so resolution against the catalog
 * is required to render a correct name.
 */
export function resolveSiblingAdjacency(
  projects: Record<string, ProjectConfig>,
  entries: string[] | undefined,
  selfProjectId: string,
): SiblingAdjacency[] {
  if (!entries?.length) return [];

  const resolved: SiblingAdjacency[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const repoId = matchSiblingProjectId(entry, projects);
    if (!repoId || repoId === selfProjectId || seen.has(repoId)) continue;
    seen.add(repoId);

    const project = projects[repoId];
    resolved.push({
      repo: repoId,
      name: siblingName(project.path),
      displayName: project.name,
    });
  }

  return resolved;
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

/**
 * Recover the sibling's real repo name from its isolated-worktree path. The path
 * basename is the segment `{sessionId}__sib__{name}`; stripping the known
 * `{sessionId}__sib__` prefix yields the name. Returns null when the path does not
 * belong to this session (used on removeSibling to drop the adjacency link).
 */
export function siblingNameFromPath(sessionId: string, siblingPath: string): string | null {
  const prefix = `${sessionId}${SIBLING_PATH_SEP}`;
  const segment = basename(siblingPath.replace(/[/\\]+$/, ""));
  return segment.startsWith(prefix) ? segment.slice(prefix.length) : null;
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
 * Create (or replace) a directory symlink at `linkPath` pointing to `targetPath`.
 * Uses a junction on Windows (no admin/Developer Mode needed for directories).
 */
function linkDir(targetPath: string, linkPath: string): void {
  if (pathExists(linkPath)) {
    rmSync(linkPath, { recursive: true, force: true });
  }
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(targetPath, linkPath, isWindows() ? "junction" : "dir");
}

/**
 * Create a read-only adjacency symlink at `linkPath` pointing to the source repo.
 * Uses a junction on Windows (no admin/Developer Mode needed for directories).
 */
export function createReadonlySiblingLink(sourcePath: string, linkPath: string): void {
  linkDir(sourcePath, linkPath);
}

/** Best-effort removal of a sibling symlink/junction (and any stale dir at the path). */
export function removeSiblingLink(linkPath: string): void {
  if (!pathExists(linkPath)) return;
  rmSync(linkPath, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Assembled adjacency view (#1095 Decision 3 / Option 1)
//
// A worktree-mode sibling lives at {worktreeDir}/{sessionId}__sib__{name}, while
// the session's primary worktree is {worktreeDir}/{sessionId} — siblings of the
// SAME parent dir, so a naive ../{name} from the primary would not resolve and
// the parent is shared across sessions (the #1095 collision). Instead each
// session gets its own assembled view at {worktreeDir}/{sessionId}__ws/ holding
// symlinks named by the REAL repo name: the primary worktree and each sibling
// worktree. Sibling-aware tools run with cwd = {sessionId}__ws/{primaryRepoName},
// so ../{siblingRepoName} resolves. Per-session __ws → no cross-session collision.
// ---------------------------------------------------------------------------

/** The per-session assembled-view directory: `{worktreeDir}/{sessionId}__ws`. */
export function assembledViewDir(worktreeDir: string, sessionId: string): string {
  const segment = `${sessionId}${SIBLING_ASSEMBLED_SUFFIX}`;
  if (!SAFE_PATH_SEGMENT.test(segment)) {
    throw new Error(
      `Invalid assembled-view segment "${segment}": must match ${SAFE_PATH_SEGMENT}`,
    );
  }
  return join(worktreeDir, segment);
}

/** The assembled primary-view path tools run in: `{__ws}/{primaryRepoName}`. */
export function assembledPrimaryViewPath(
  worktreeDir: string,
  sessionId: string,
  primaryRepoName: string,
): string {
  return join(assembledViewDir(worktreeDir, sessionId), primaryRepoName);
}

/**
 * Ensure the assembled view exists with the primary repo symlinked under its real
 * name. Idempotent (creating the primary link also creates the `__ws` dir).
 * Returns the assembled primary-view path — the cwd for sibling-aware tools.
 */
export function ensureAssembledPrimaryView(
  worktreeDir: string,
  sessionId: string,
  primaryRepoName: string,
  primaryWorktreePath: string,
): string {
  const primaryView = assembledPrimaryViewPath(worktreeDir, sessionId, primaryRepoName);
  linkDir(primaryWorktreePath, primaryView);
  return primaryView;
}

/** Symlink a sibling's worktree into the assembled view under its real repo name. */
export function linkSiblingIntoView(
  worktreeDir: string,
  sessionId: string,
  siblingRepoName: string,
  siblingWorktreePath: string,
): void {
  linkDir(siblingWorktreePath, join(assembledViewDir(worktreeDir, sessionId), siblingRepoName));
}

/** Remove a sibling's adjacency symlink from the assembled view (best-effort). */
export function unlinkSiblingFromView(
  worktreeDir: string,
  sessionId: string,
  siblingRepoName: string,
): void {
  removeSiblingLink(join(assembledViewDir(worktreeDir, sessionId), siblingRepoName));
}

/** Remove the entire per-session assembled view (best-effort) — used on kill. */
export function removeAssembledView(worktreeDir: string, sessionId: string): void {
  removeSiblingLink(assembledViewDir(worktreeDir, sessionId));
}
