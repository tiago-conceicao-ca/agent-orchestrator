import { handleSetTaskModel } from "@/lib/sdlc-run-actions";
import { buildWebSdlcEngine } from "@/lib/sdlc-services";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { project, taskId, model } = (await req.json().catch(() => ({}))) as {
      project?: string;
      taskId?: string;
      model?: string | null;
    };
    const { engine } = await buildWebSdlcEngine(project);
    const result = await handleSetTaskModel(engine, id, taskId, model);
    return Response.json(
      { ok: result.ok, message: result.message, run: result.run },
      { status: result.status },
    );
  } catch (err) {
    console.error("[POST /api/sdlc/runs/[id]/set-model]", err);
    return Response.json(
      { ok: false, message: err instanceof Error ? err.message : "Failed to set task model" },
      { status: 500 },
    );
  }
}
