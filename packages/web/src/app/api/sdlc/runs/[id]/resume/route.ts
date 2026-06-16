import { handleResume } from "@/lib/sdlc-run-actions";
import { buildWebSdlcEngine } from "@/lib/sdlc-services";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { project, fromPhase } = (await req.json().catch(() => ({}))) as {
      project?: string;
      fromPhase?: string;
    };
    const { engine } = await buildWebSdlcEngine(project);
    const result = await handleResume(engine, id, fromPhase);
    return Response.json(
      { ok: result.ok, message: result.message, run: result.run },
      { status: result.status },
    );
  } catch (err) {
    console.error("[POST /api/sdlc/runs/[id]/resume]", err);
    return Response.json(
      { ok: false, message: err instanceof Error ? err.message : "Failed to resume run" },
      { status: 500 },
    );
  }
}
