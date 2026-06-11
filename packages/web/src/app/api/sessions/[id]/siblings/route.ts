import { type NextRequest } from "next/server";
import { getServices } from "@/lib/services";
import { validateIdentifier, validateString } from "@/lib/validation";
import { SessionNotFoundError, recordActivityEvent, type SiblingMode } from "@aoagents/ao-core";
import {
  getCorrelationId,
  jsonWithCorrelation,
  recordApiObservation,
  resolveProjectIdForSessionId,
} from "@/lib/observability";

const SIBLING_MODES: ReadonlySet<SiblingMode> = new Set<SiblingMode>([
  "worktree",
  "readonly-symlink",
]);

const MAX_REPO_LENGTH = 256;
const MAX_BRANCH_LENGTH = 256;

/** Map a core sibling error message to an HTTP status. */
function statusForSiblingError(err: unknown): number {
  if (err instanceof SessionNotFoundError) return 404;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Unknown sibling repo")) return 400;
  if (msg.includes("already mounted")) return 409;
  if (msg.includes("is not mounted")) return 404;
  return 500;
}

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

/** POST /api/sessions/:id/siblings — mount a sibling repo (#1095). Body: { repo, branch?, mode? }. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  const startedAt = Date.now();
  const { id } = await params;

  const idErr = validateIdentifier(id, "id");
  if (idErr) {
    return jsonWithCorrelation({ error: idErr }, { status: 400 }, correlationId);
  }

  let body: Record<string, unknown> | null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonWithCorrelation(
      { error: "Invalid JSON in request body" },
      { status: 400 },
      correlationId,
    );
  }

  const repoErr = validateString(body?.["repo"], "repo", MAX_REPO_LENGTH);
  if (repoErr) {
    return jsonWithCorrelation({ error: repoErr }, { status: 400 }, correlationId);
  }
  const repo = (body?.["repo"] as string).trim();

  const rawBranch = body?.["branch"];
  if (rawBranch !== undefined && rawBranch !== null) {
    const branchErr = validateString(rawBranch, "branch", MAX_BRANCH_LENGTH);
    if (branchErr) {
      return jsonWithCorrelation({ error: branchErr }, { status: 400 }, correlationId);
    }
  }
  const branch = typeof rawBranch === "string" ? rawBranch : undefined;

  const rawMode = body?.["mode"];
  if (rawMode !== undefined && rawMode !== null && !SIBLING_MODES.has(rawMode as SiblingMode)) {
    return jsonWithCorrelation(
      { error: 'mode must be "worktree" or "readonly-symlink"' },
      { status: 400 },
      correlationId,
    );
  }
  const mode = typeof rawMode === "string" ? (rawMode as SiblingMode) : undefined;

  const { config, sessionManager } = await getServices();
  const projectId = resolveProjectIdForSessionId(config, id);
  try {
    const sibling = await sessionManager.addSibling(id, repo, { branch, mode });
    recordApiObservation({
      config,
      method: "POST",
      path: "/api/sessions/[id]/siblings",
      correlationId,
      startedAt,
      outcome: "success",
      statusCode: 201,
      projectId,
      sessionId: id,
    });
    recordActivityEvent({
      projectId,
      sessionId: id,
      source: "api",
      kind: "api.session_sibling_added",
      summary: `sibling mounted: ${sibling.repo} (${sibling.mode})`,
      data: { repo: sibling.repo, mode: sibling.mode, branch: sibling.branch },
    });
    return jsonWithCorrelation({ sibling }, { status: 201 }, correlationId);
  } catch (err) {
    const statusCode = statusForSiblingError(err);
    const msg = err instanceof Error ? err.message : "Failed to mount sibling";
    recordApiObservation({
      config,
      method: "POST",
      path: "/api/sessions/[id]/siblings",
      correlationId,
      startedAt,
      outcome: "failure",
      statusCode,
      projectId,
      sessionId: id,
      reason: msg,
    });
    return jsonWithCorrelation({ error: msg }, { status: statusCode }, correlationId);
  }
}

/** DELETE /api/sessions/:id/siblings?repo=<repo> — unmount a sibling repo (#1095). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  const startedAt = Date.now();
  const { id } = await params;

  const idErr = validateIdentifier(id, "id");
  if (idErr) {
    return jsonWithCorrelation({ error: idErr }, { status: 400 }, correlationId);
  }

  const repo = request.nextUrl.searchParams.get("repo");
  const repoErr = validateString(repo, "repo", MAX_REPO_LENGTH);
  if (repoErr) {
    return jsonWithCorrelation({ error: repoErr }, { status: 400 }, correlationId);
  }

  const { config, sessionManager } = await getServices();
  const projectId = resolveProjectIdForSessionId(config, id);
  try {
    await sessionManager.removeSibling(id, repo as string);
    recordApiObservation({
      config,
      method: "DELETE",
      path: "/api/sessions/[id]/siblings",
      correlationId,
      startedAt,
      outcome: "success",
      statusCode: 200,
      projectId,
      sessionId: id,
    });
    recordActivityEvent({
      projectId,
      sessionId: id,
      source: "api",
      kind: "api.session_sibling_removed",
      summary: `sibling unmounted: ${repo}`,
      data: { repo },
    });
    return jsonWithCorrelation({ ok: true, repo }, { status: 200 }, correlationId);
  } catch (err) {
    const statusCode = statusForSiblingError(err);
    const msg = err instanceof Error ? err.message : "Failed to unmount sibling";
    recordApiObservation({
      config,
      method: "DELETE",
      path: "/api/sessions/[id]/siblings",
      correlationId,
      startedAt,
      outcome: "failure",
      statusCode,
      projectId,
      sessionId: id,
      reason: msg,
    });
    return jsonWithCorrelation({ error: msg }, { status: statusCode }, correlationId);
  }
}
