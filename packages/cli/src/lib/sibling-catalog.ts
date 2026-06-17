import type { ProjectConfig } from "@contaazul/cahi-core";

/**
 * An available-siblings catalog entry (#1095): a registered project that a
 * session can mount as a sibling repo. `id` is the registered project id (the
 * value `cahi session sibling add` / the web API resolve against); `repo`/`path`
 * identify the source repo.
 */
export interface SiblingCatalogEntry {
  id: string;
  name: string;
  /** owner/name of the source repo (absent for path-only project configs). */
  repo?: string;
  path: string;
}

/**
 * Build the available-siblings catalog (#1095) from the registered projects.
 *
 * The catalog is purely *derived* from config — establishing it at `cahi start`
 * creates no worktree (a shared sibling worktree at start would reintroduce the
 * #1095 collision). Sessions mount siblings on demand via the core's per-session
 * isolated worktree.
 *
 * @param options.excludeProjectId omit this project (a project is not its own sibling).
 */
export function buildSiblingCatalog(
  projects: Record<string, ProjectConfig>,
  options?: { excludeProjectId?: string },
): SiblingCatalogEntry[] {
  return Object.entries(projects)
    .filter(([id]) => id !== options?.excludeProjectId)
    .map(([id, project]) => ({
      id,
      name: project.name ?? id,
      repo: project.repo,
      path: project.path,
    }));
}

/** One-line `id (repo)` summary of the catalog for `cahi start` output. Empty → null. */
export function formatSiblingCatalog(catalog: SiblingCatalogEntry[]): string | null {
  if (catalog.length === 0) return null;
  return catalog.map((entry) => (entry.repo ? `${entry.id} (${entry.repo})` : entry.id)).join(", ");
}
