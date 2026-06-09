import { handleApprove } from "@/lib/sdlc-approve";
import { buildWebSdlcEngine } from "@/lib/sdlc-services";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { runId, project } = (await req.json()) as { runId?: string; project?: string };
    if (!runId) {
      return Response.json({ ok: false, message: "runId is required." }, { status: 400 });
    }
    const { engine } = await buildWebSdlcEngine(project);
    const result = await handleApprove(engine, runId);
    return Response.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    console.error("[POST /api/sdlc/approve]", err);
    return Response.json(
      { ok: false, message: err instanceof Error ? err.message : "Failed to approve run" },
      { status: 500 },
    );
  }
}
