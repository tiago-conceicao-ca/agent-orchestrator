import type { TaskGraph } from "./types.js";

export interface ValidationIssue {
  severity: "error" | "warning";
  code: "DUPLICATE_NAME" | "UNRESOLVED_DEPENDENCY" | "CYCLE_DETECTED" | "MISSING_TASK_SECTION";
  message: string;
}
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** @param sectionNames the `## Task: <name>` headings found in the plan markdown. */
export function validateTaskGraph(graph: TaskGraph, sectionNames: string[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const names = graph.tasks.map((t) => t.name);
  const nameSet = new Set(names);

  // duplicates
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n))
      issues.push({ severity: "error", code: "DUPLICATE_NAME", message: `Duplicate task name: '${n}'.` });
    seen.add(n);
  }

  // unresolved deps
  for (const t of graph.tasks)
    for (const dep of t.dependsOn)
      if (!nameSet.has(dep))
        issues.push({
          severity: "error",
          code: "UNRESOLVED_DEPENDENCY",
          message: `Task '${t.name}' depends on unknown task '${dep}'.`,
        });

  // missing ## Task sections
  const sections = new Set(sectionNames);
  for (const n of names)
    if (!sections.has(n))
      issues.push({
        severity: "error",
        code: "MISSING_TASK_SECTION",
        message: `Task '${n}' has no matching '## Task: ${n}' section.`,
      });

  // cycle detection (Kahn's algorithm) — only if deps resolve AND names are unique.
  // The inDeg/adj maps de-dupe by name while `names.length` counts duplicates, so a
  // duplicate-name graph would otherwise report a spurious cycle.
  if (!issues.some((i) => i.code === "UNRESOLVED_DEPENDENCY" || i.code === "DUPLICATE_NAME")) {
    const inDeg = new Map<string, number>(names.map((n) => [n, 0]));
    const adj = new Map<string, string[]>(names.map((n) => [n, []]));
    for (const t of graph.tasks)
      for (const dep of t.dependsOn) {
        // edge dep -> t
        adj.get(dep)!.push(t.name);
        inDeg.set(t.name, inDeg.get(t.name)! + 1);
      }
    const queue = names.filter((n) => inDeg.get(n) === 0);
    let processed = 0;
    while (queue.length) {
      const n = queue.shift()!;
      processed++;
      for (const m of adj.get(n)!) {
        inDeg.set(m, inDeg.get(m)! - 1);
        if (inDeg.get(m) === 0) queue.push(m);
      }
    }
    if (processed !== names.length)
      issues.push({
        severity: "error",
        code: "CYCLE_DETECTED",
        message: "Task Graph has a dependency cycle.",
      });
  }

  return { valid: issues.every((i) => i.severity !== "error"), issues };
}
