export const COMPLEXITY = ["LOW", "MEDIUM", "HIGH"] as const;
export type Complexity = (typeof COMPLEXITY)[number];

/** One entry in the plan's `## Task Graph` YAML block (tm task-graph-format). */
export interface TaskGraphTask {
  name: string; // must match a `## Task: <name>` heading exactly
  complexity: Complexity;
  tdd: boolean;
  dependsOn: string[]; // task names; [] = no deps
  summary: string;
  acceptanceCriteria: string[];
}

export interface TaskGraph {
  tasks: TaskGraphTask[];
}

export type TaskStatus = "backlog" | "ready" | "in_progress" | "in_review" | "done" | "blocked";

/** Normalized output: an epic owning tasks with dependency edges. */
export interface Epic {
  id: string; // slug/uuid
  title: string;
  description: string;
  tasks: WorkflowTask[];
  dependencies: Dependency[]; // blocking edges between task ids
}

export interface WorkflowTask {
  id: string;
  title: string; // == TaskGraphTask.name
  summary: string;
  complexity: Complexity;
  tdd: boolean;
  acceptanceCriteria: string[];
  status: TaskStatus;
}

export interface Dependency {
  /** task id that is blocked until `dependsOnTaskId` is done */
  taskId: string;
  dependsOnTaskId: string;
  type: "blocks";
}
