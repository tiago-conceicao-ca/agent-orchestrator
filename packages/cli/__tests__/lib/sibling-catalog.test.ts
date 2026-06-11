import { describe, it, expect } from "vitest";
import type { ProjectConfig } from "@aoagents/ao-core";
import { buildSiblingCatalog, formatSiblingCatalog } from "../../src/lib/sibling-catalog.js";

function project(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    name: "My App",
    repo: "org/my-app",
    path: "/repos/my-app",
    defaultBranch: "main",
    sessionPrefix: "app",
    ...overrides,
  } as ProjectConfig;
}

describe("buildSiblingCatalog", () => {
  it("derives one catalog entry per registered project", () => {
    const catalog = buildSiblingCatalog({
      "my-app": project(),
      "ds-front": project({ name: "Design System", repo: "org/ds-front", path: "/repos/ds-front" }),
    });

    expect(catalog).toEqual([
      { id: "my-app", name: "My App", repo: "org/my-app", path: "/repos/my-app" },
      { id: "ds-front", name: "Design System", repo: "org/ds-front", path: "/repos/ds-front" },
    ]);
  });

  it("excludes the given project id (the project cannot be its own sibling)", () => {
    const catalog = buildSiblingCatalog(
      {
        "my-app": project(),
        "ds-front": project({ name: "Design System", repo: "org/ds-front", path: "/repos/ds-front" }),
      },
      { excludeProjectId: "my-app" },
    );

    expect(catalog.map((c) => c.id)).toEqual(["ds-front"]);
  });

  it("falls back to the project id when name is absent", () => {
    const catalog = buildSiblingCatalog({
      lib: project({ name: undefined as unknown as string, repo: "org/lib", path: "/repos/lib" }),
    });
    expect(catalog[0].name).toBe("lib");
  });

  it("returns an empty catalog when there are no registered projects", () => {
    expect(buildSiblingCatalog({})).toEqual([]);
  });
});

describe("formatSiblingCatalog", () => {
  it("renders id (repo) pairs", () => {
    const summary = formatSiblingCatalog([
      { id: "ds-front", name: "Design System", repo: "org/ds-front", path: "/repos/ds-front" },
      { id: "lib", name: "Lib", repo: "org/lib", path: "/repos/lib" },
    ]);
    expect(summary).toBe("ds-front (org/ds-front), lib (org/lib)");
  });

  it("returns null for an empty catalog", () => {
    expect(formatSiblingCatalog([])).toBeNull();
  });
});
