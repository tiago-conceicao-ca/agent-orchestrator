import { getProjectDir } from "@aoagents/ao-core";
import { RunStore } from "@aoagents/ao-sdlc";
import { titlesFromRun, toKanban, type RunView } from "@/lib/sdlc-board";

// NOTE: Next.js 15 route modules may only export valid route fields (GET, dynamic, …).
// The pure `toKanban` mapper lives in @/lib/sdlc-board and is unit-tested there.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { getServices } = await import("@/lib/services");
    const { config } = await getServices();
    const runs: RunView[] = [];
    for (const projectId of Object.keys(config.projects)) {
      const store = new RunStore(getProjectDir(projectId));
      for (const run of await store.list()) {
        runs.push({
          id: run.id,
          projectId,
          workflow: run.workflow,
          status: run.status,
          pendingApproval: run.pendingApproval,
          board: toKanban(run, titlesFromRun(run)),
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
