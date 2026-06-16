import type { Dependency, TaskPass, WorkflowTask } from "../plan/types.js";
import { passesForComplexity } from "./passes-config.js";

/** Stable pass id within an epic: `${taskId}__${role}`. */
export function passId(taskId: string, role: string): string {
  return `${taskId}__${role}`;
}

/**
 * Expand each logical task into its graduated, chained lens passes
 * (taskmaster `_create_impl_tasks`):
 *
 * - The `initial` pass implements from the task. It `waitsFor` the TERMINAL
 *   pass of each upstream logical dependency — so a downstream task's first
 *   pass only starts once the upstream task's LAST pass is done (cross-task
 *   deps wire to terminal passes, not to the upstream initial pass).
 * - Each review pass `waitsFor` the previous pass and records `previousPassId`
 *   (the diff it reviews) + `initialPassId` (the origin implementation).
 *
 * Returns NEW task objects with `passes` populated; inputs are not mutated. The
 * logical-task dependency graph is preserved unchanged — passes are an
 * intra-task refinement layered on top of it.
 */
export function expandTaskPasses(tasks: WorkflowTask[], dependencies: Dependency[]): WorkflowTask[] {
  // Map each logical task to its upstream dependency task ids (blocks edges).
  const upstreamByTask = new Map<string, string[]>(tasks.map((t) => [t.id, []]));
  for (const dep of dependencies) {
    if (dep.type !== "blocks") continue;
    upstreamByTask.get(dep.taskId)?.push(dep.dependsOnTaskId);
  }

  // The terminal (last) pass id for each task = its highest-tier review pass.
  const terminalPassId = new Map<string, string>();
  for (const t of tasks) {
    const roles = passesForComplexity(t.complexity);
    terminalPassId.set(t.id, passId(t.id, roles[roles.length - 1]!.role));
  }

  return tasks.map((task) => {
    const defs = passesForComplexity(task.complexity);
    const initialId = passId(task.id, defs[0]!.role);
    const passes: TaskPass[] = defs.map((def, i) => {
      const id = passId(task.id, def.role);
      if (i === 0) {
        // initial: gated behind the terminal passes of upstream logical deps.
        const waitsFor = (upstreamByTask.get(task.id) ?? [])
          .map((depId) => terminalPassId.get(depId))
          .filter((x): x is string => Boolean(x));
        return { id, role: def.role, name: def.name, template: def.template, model: def.model, waitsFor };
      }
      const previousPassId = passId(task.id, defs[i - 1]!.role);
      return {
        id,
        role: def.role,
        name: def.name,
        template: def.template,
        model: def.model,
        waitsFor: [previousPassId],
        previousPassId,
        initialPassId: initialId,
      };
    });
    return { ...task, passes };
  });
}
