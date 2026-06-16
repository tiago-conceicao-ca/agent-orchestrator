import "server-only";

import { getProjectDir } from "@contaazul/cahi-core";
import { RunStore, type WorkflowRun } from "@contaazul/cahi-sdlc";
import {
  assignTaskNumbers,
  lastErrorFromRun,
  planArtifactFromRun,
  titlesFromRun,
  toKanban,
  toPhaseStates,
  toVerdictViews,
  type RunView,
} from "@/lib/sdlc-board";
import { enrichRunTasks, linkedSessionsByTaskId } from "@/lib/sdlc-tasks";

// Single source of truth for turning a persisted WorkflowRun into the enriched,
// client-safe RunView the dashboard consumes. Both the list route
// (GET /api/sdlc/runs) and the single-run route (GET /api/sdlc/runs/[id]) use
// this so the two views never drift. Server-only: it reads the run store and
// session metadata off disk.

/** Map one persisted run to its enriched RunView (linked sessions for `projectId`). */
export function mapRunToView(
  run: WorkflowRun,
  projectId: string,
  linked: ReturnType<typeof linkedSessionsByTaskId>,
): RunView {
  return {
    id: run.id,
    projectId,
    workflow: run.workflow,
    status: run.status,
    pendingApproval: run.pendingApproval,
    createdAt: run.createdAt,
    board: toKanban(run, titlesFromRun(run), assignTaskNumbers(run)),
    tasks: enrichRunTasks(run, linked),
    phaseStates: toPhaseStates(run),
    verdicts: toVerdictViews(run),
    planArtifact: planArtifactFromRun(run),
    lastError: lastErrorFromRun(run),
    prMode: run.prMode ?? "per-task",
  };
}

/** Load + enrich every run across all configured projects (list route). */
export async function loadAllRunViews(): Promise<RunView[]> {
  const { getServices } = await import("@/lib/services");
  const { config } = await getServices();
  const runs: RunView[] = [];
  for (const projectId of Object.keys(config.projects)) {
    const store = new RunStore(getProjectDir(projectId));
    const linked = linkedSessionsByTaskId(projectId);
    for (const run of await store.list()) {
      runs.push(mapRunToView(run, projectId, linked));
    }
  }
  return runs;
}

/** Load + enrich a single run by id, searching every project (null if unknown). */
export async function loadRunView(id: string): Promise<RunView | null> {
  const { getServices } = await import("@/lib/services");
  const { config } = await getServices();
  for (const projectId of Object.keys(config.projects)) {
    const store = new RunStore(getProjectDir(projectId));
    const run = await store.load(id);
    if (run) return mapRunToView(run, projectId, linkedSessionsByTaskId(projectId));
  }
  return null;
}
