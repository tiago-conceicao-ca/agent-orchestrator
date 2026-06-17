import type { ProjectConfig, SessionManager } from "./types.js";
import { getOrchestratorSessionId } from "./orchestrator-session-strategy.js";
import { readMetadataRaw } from "./metadata.js";

/** Minimal SessionManager surface the helper needs (the real manager satisfies it). */
export type OrchestratorNotifier = Pick<SessionManager, "send">;

/**
 * Best-effort notify a project's orchestrator session over the same
 * `SessionManager.send` back-channel a worker uses with `cahi send`.
 *
 * No-ops when no orchestrator session exists on disk for the project —
 * existence-on-disk of the canonical orchestrator metadata is the signal that
 * the orchestrator workflow is in play (mirrors the worker-prompt check in
 * session-manager). Never throws: a delivery failure must not affect the caller
 * (a polling loop, the SDLC engine wiring, etc.).
 */
export async function notifyOrchestrator(
  sessionManager: OrchestratorNotifier,
  project: Pick<ProjectConfig, "sessionPrefix">,
  sessionsDir: string,
  message: string,
): Promise<void> {
  try {
    const orchestratorId = getOrchestratorSessionId(project);
    if (readMetadataRaw(sessionsDir, orchestratorId) === null) return;
    await sessionManager.send(orchestratorId, message);
  } catch {
    // Best-effort: swallow so a notification failure never propagates.
  }
}
