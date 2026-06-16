import { handleRetry } from "@/lib/sdlc-run-actions";
import { buildWebSdlcEngine } from "@/lib/sdlc-services";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { project, taskId } = (await req.json().catch(() => ({}))) as {
      project?: string;
      taskId?: string;
    };
    const { engine } = await buildWebSdlcEngine(project);
    const result = await handleRetry(engine, id, taskId);
    return Response.json(
      { ok: result.ok, message: result.message, run: result.run },
      { status: result.status },
    );
  } catch (err) {
    console.error("[POST /api/sdlc/runs/[id]/retry]", err);
    return Response.json(
      { ok: false, message: err instanceof Error ? err.message : "Failed to retry task" },
      { status: 500 },
    );
  }
}
