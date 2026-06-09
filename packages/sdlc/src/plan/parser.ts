import * as yaml from "js-yaml";
import { COMPLEXITY, type Complexity, type TaskGraph, type TaskGraphTask } from "./types.js";

// Mirrors tm parser.py regex: ## Task Graph followed by a ```yaml fence.
const TASK_GRAPH_RE = /##\s+Task\s+Graph\s*\n+```ya?ml\s*\n([\s\S]*?)\n```/i;

export function extractTaskGraphYaml(content: string): string {
  const m = content.match(TASK_GRAPH_RE);
  if (!m) throw new Error("Plan is missing a '## Task Graph' YAML block.");
  const body = m[1].trim();
  if (!body) throw new Error("The '## Task Graph' YAML block is empty.");
  return body;
}

function asStringArray(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    throw new Error("Expected a list of strings.");
  return v as string[];
}

export function parseTaskGraph(yamlStr: string): TaskGraph {
  const root = yaml.load(yamlStr);
  if (typeof root !== "object" || root === null || !("tasks" in root))
    throw new Error("Task Graph YAML must be an object with a 'tasks' key.");
  const rawTasks = (root as { tasks: unknown }).tasks;
  if (!Array.isArray(rawTasks)) throw new Error("'tasks' must be a list.");

  const tasks: TaskGraphTask[] = rawTasks.map((raw, i) => {
    const r = raw as Record<string, unknown>;
    const where = `tasks[${i}]`;
    if (typeof r.name !== "string" || !r.name.trim())
      throw new Error(`${where}: 'name' is required and must be a non-empty string.`);
    if (typeof r.complexity !== "string" || !COMPLEXITY.includes(r.complexity as Complexity))
      throw new Error(`${where} ('${r.name}'): 'complexity' must be one of ${COMPLEXITY.join("/")}.`);
    if (typeof r.tdd !== "boolean")
      throw new Error(`${where} ('${r.name}'): 'tdd' must be a boolean.`);
    if (typeof r.summary !== "string")
      throw new Error(`${where} ('${r.name}'): 'summary' is required.`);
    return {
      name: r.name,
      complexity: r.complexity as Complexity,
      tdd: r.tdd,
      summary: r.summary,
      dependsOn: asStringArray(r.depends_on),
      acceptanceCriteria: asStringArray(r.acceptance_criteria),
    };
  });
  return { tasks };
}
