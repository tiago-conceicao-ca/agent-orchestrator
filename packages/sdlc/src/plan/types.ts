export const COMPLEXITY = ["LOW", "MEDIUM", "HIGH"] as const;
export type Complexity = (typeof COMPLEXITY)[number];

/**
 * Selectable claude CLI model aliases for a generate-backend task. Free-form
 * strings reach `claude --model`, but these are the canonical, UI-offered set.
 */
export const SDLC_MODELS = ["opus", "sonnet", "haiku"] as const;
export type SdlcModel = (typeof SDLC_MODELS)[number];

/** Default model per complexity bucket (the engine's best-fit assignment). */
export const COMPLEXITY_MODEL_DEFAULT: Record<Complexity, SdlcModel> = {
  HIGH: "opus",
  MEDIUM: "sonnet",
  LOW: "haiku",
};

/** One entry in the plan's `## Task Graph` YAML block (tm task-graph-format). */
export interface TaskGraphTask {
  name: string; // must match a `## Task: <name>` heading exactly
  complexity: Complexity;
  tdd: boolean;
  dependsOn: string[]; // task names; [] = no deps
  summary: string;
  acceptanceCriteria: string[];
  /** Optional explicit model alias from the plan; preserved over the complexity default. */
  model?: SdlcModel;
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
  /**
   * Model alias the worker launches with (`claude --model`). Assigned from the
   * complexity default at normalize, overridable per-task via the dashboard.
   * Undefined = no override; spawn falls back to the project's agent model.
   */
  model?: string;
}

export interface Dependency {
  /** task id that is blocked until `dependsOnTaskId` is done */
  taskId: string;
  dependsOnTaskId: string;
  type: "blocks";
}
