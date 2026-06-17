import { type NextRequest } from "next/server";
import { getServices } from "@/lib/services";
import { validateIdentifier } from "@/lib/validation";
import {
  getCorrelationId,
  jsonWithCorrelation,
  recordApiObservation,
  resolveProjectIdForSessionId,
} from "@/lib/observability";

// Siblings are configured per project and mounted at spawn (#1095) — sessions
// are read-only consumers, so this route only lists. Mutations go through
// PATCH /api/projects/[id] (siblings array) or the `cahi session sibling` CLI.

/** GET /api/sessions/:id/siblings — list a session's mounted siblings (#1095). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  const startedAt = Date.now();
  const { id } = await params;

  const idErr = validateIdentifier(id, "id");
  if (idErr) {
    return jsonWithCorrelation({ error: idErr }, { status: 400 }, correlationId);
  }

  try {
    const { config, sessionManager } = await getServices();
    const projectId = resolveProjectIdForSessionId(config, id);
    const session = await sessionManager.get(id);
    if (!session) {
      recordApiObservation({
        config,
        method: "GET",
        path: "/api/sessions/[id]/siblings",
        correlationId,
        startedAt,
        outcome: "failure",
        statusCode: 404,
        projectId,
        sessionId: id,
      });
      return jsonWithCorrelation(
        { error: `Session '${id}' not found` },
        { status: 404 },
        correlationId,
      );
    }
    recordApiObservation({
      config,
      method: "GET",
      path: "/api/sessions/[id]/siblings",
      correlationId,
      startedAt,
      outcome: "success",
      statusCode: 200,
      projectId,
      sessionId: id,
    });
    return jsonWithCorrelation({ siblings: session.siblings ?? [] }, { status: 200 }, correlationId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list siblings";
    return jsonWithCorrelation({ error: msg }, { status: 500 }, correlationId);
  }
}
