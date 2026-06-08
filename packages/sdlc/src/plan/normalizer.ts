import { extractTaskGraphYaml, parseTaskGraph } from "./parser.js";
import { validateTaskGraph } from "./validator.js";
import type { Epic, WorkflowTask, Dependency } from "./types.js";

const TASK_HEADING_RE = /^##\s+Task:\s+(.+?)\s*$/gm;

export function extractTaskSectionNames(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(TASK_HEADING_RE)) names.push(m[1].trim());
  return names;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export interface EpicMeta {
  id: string;
  title: string;
  description: string;
}

export function normalizePlan(planMarkdown: string, meta: EpicMeta): Epic {
  const graph = parseTaskGraph(extractTaskGraphYaml(planMarkdown));
  const sections = extractTaskSectionNames(planMarkdown);
  const result = validateTaskGraph(graph, sections);
  if (!result.valid) {
    const msg = result.issues
      .filter((i) => i.severity === "error")
      .map((i) => `[${i.code}] ${i.message}`)
      .join("\n");
    throw new Error(`Plan is not ready:\n${msg}`);
  }

  const idByName = new Map<string, string>();
  const tasks: WorkflowTask[] = graph.tasks.map((t) => {
    const id = `${meta.id}__${slug(t.name)}`;
    idByName.set(t.name, id);
    return {
      id,
      title: t.name,
      summary: t.summary,
      complexity: t.complexity,
      tdd: t.tdd,
      acceptanceCriteria: t.acceptanceCriteria,
      status: "backlog",
    };
  });

  const dependencies: Dependency[] = [];
  for (const t of graph.tasks)
    for (const dep of t.dependsOn)
      dependencies.push({
        taskId: idByName.get(t.name)!,
        dependsOnTaskId: idByName.get(dep)!,
        type: "blocks",
      });

  return { id: meta.id, title: meta.title, description: meta.description, tasks, dependencies };
}
