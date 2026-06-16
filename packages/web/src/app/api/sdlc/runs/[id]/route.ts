import { loadRunView } from "@/lib/sdlc-run-view";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const run = await loadRunView(id);
    if (!run) return Response.json({ error: "Run not found." }, { status: 404 });
    return Response.json({ run });
  } catch (err) {
    console.error("[GET /api/sdlc/runs/[id]]", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load SDLC run" },
      { status: 500 },
    );
  }
}
