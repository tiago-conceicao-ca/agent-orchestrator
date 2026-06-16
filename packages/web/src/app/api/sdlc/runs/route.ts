import { loadAllRunViews } from "@/lib/sdlc-run-view";

// NOTE: Next.js 15 route modules may only export valid route fields (GET, dynamic, …).
// The run→view mapping + store access lives in @/lib/sdlc-run-view (server-only) and
// the pure mappers in @/lib/sdlc-board — both unit-tested there.

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ runs: await loadAllRunViews() });
  } catch (err) {
    console.error("[GET /api/sdlc/runs]", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load SDLC runs" },
      { status: 500 },
    );
  }
}
