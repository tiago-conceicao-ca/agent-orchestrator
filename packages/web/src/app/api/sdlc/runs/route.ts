import { getProjectDir } from "@aoagents/ao-core";
import { RunStore } from "@aoagents/ao-sdlc";
import {
  assignTaskNumbers,
  planArtifactFromRun,
  titlesFromRun,
  toKanban,
  toPhaseStates,
  toVerdictViews,
  type RunView,
} from "@/lib/sdlc-board";
import { enrichRunTasks, linkedSessionsByTaskId } from "@/lib/sdlc-tasks";

// NOTE: Next.js 15 route modules may only export valid route fields (GET, dynamic, …).
// The pure mappers (toKanban, assignTaskNumbers) live in @/lib/sdlc-board and the
// server-only task enrichment in @/lib/sdlc-tasks — both unit-tested there.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { getServices } = await import("@/lib/services");
    const { config } = await getServices();
    const runs: RunView[] = [];
    for (const projectId of Object.keys(config.projects)) {
      const store = new RunStore(getProjectDir(projectId));
      const linked = linkedSessionsByTaskId(projectId);
      for (const run of await store.list()) {
        runs.push({
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
        });
      }
    }
    return Response.json({ runs });
  } catch (err) {
    console.error("[GET /api/sdlc/runs]", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load SDLC runs" },
      { status: 500 },
    );
  }
}
