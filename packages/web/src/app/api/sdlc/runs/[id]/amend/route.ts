import { handleAmend } from "@/lib/sdlc-run-actions";
import { buildWebSdlcEngine } from "@/lib/sdlc-services";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { project, comment } = (await req.json().catch(() => ({}))) as {
      project?: string;
      comment?: string;
    };
    const { engine } = await buildWebSdlcEngine(project);
    const result = await handleAmend(engine, id, comment);
    return Response.json(
      { ok: result.ok, message: result.message, run: result.run },
      { status: result.status },
    );
  } catch (err) {
    console.error("[POST /api/sdlc/runs/[id]/amend]", err);
    return Response.json(
      { ok: false, message: err instanceof Error ? err.message : "Failed to amend run" },
      { status: 500 },
    );
  }
}
