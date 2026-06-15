import "server-only";

import {
  getProjectDir,
  getProjectSessionsDir,
  updateMetadata,
  type Session,
} from "@aoagents/ao-core";
import {
  CA_PLAN_TO_BACKEND,
  loadLensPrompt,
  makeGenerateBackendExecutor,
  makeInputAdapter,
  makeLensGate,
  makeNormalizePlanExecutor,
  makePatternLibraryGate,
  makeSessionLensRunner,
  makeSessionPlanRunner,
  RunStore,
  smokeEvalArtifact,
  WorkflowEngine,
  type SdlcSessionSpawn,
} from "@aoagents/ao-sdlc";
import { getServices } from "./services";

// Dashboard-side engine wiring. Intentionally mirrors the CLI's buildSdlcServices
// (packages/cli/src/commands/sdlc.ts) — the shared pure logic (executors, gates,
// engine) lives in @aoagents/ao-sdlc; only the service-access + agent runners are
// app-specific. A future refactor could hoist this factory into @aoagents/ao-sdlc.

const TASK_POLL_INTERVAL_MS = 5_000;
const TASK_POLL_TIMEOUT_MS = 2 * 60 * 60 * 1_000; // 2h safety cap

/**
 * Map an AO session's terminal state to the engine's done/failed outcome.
 *
 * A successful agent that has OPENED a PR (CI green/pending) is "done" — a merge
 * is NOT required. Only a still-working session with no PR yet keeps polling.
 */
function classifyTerminal(session: Session): "done" | "failed" | null {
  const prState = session.lifecycle?.pr?.state;
  const prExists = prState === "open" || prState === "merged";
  const ciFailing =
    session.status === "ci_failed" || session.lifecycle?.pr?.reason === "ci_failing";

  // Hard failure: the process died, or a PR exists but its CI is failing.
  if (
    session.status === "errored" ||
    session.status === "killed" ||
    session.status === "terminated" ||
    ciFailing
  ) {
    return "failed";
  }

  // Success: a PR exists (open or merged, CI green/pending), or the legacy
  // status already advanced past PR creation. A merge is NOT required.
  if (prExists) return "done";
  switch (session.status) {
    case "pr_open":
    case "review_pending":
    case "mergeable":
    case "merged":
    case "done":
    case "cleanup":
      return "done";
    default:
      return null; // still working with no PR yet — keep polling
  }
}

/** Build the SDLC engine for a project from dashboard-side services. */
export async function buildWebSdlcEngine(
  projectId?: string,
): Promise<{ engine: WorkflowEngine; store: RunStore }> {
  const { config, sessionManager } = await getServices();
  const ids = Object.keys(config.projects);
  const resolved = projectId ?? (ids.length === 1 ? ids[0] : undefined);
  if (!resolved || !config.projects[resolved]) {
    throw new Error(
      projectId ? `Unknown project: ${projectId}` : `Specify a project (one of: ${ids.join(", ")}).`,
    );
  }

  const store = new RunStore(getProjectDir(resolved));
  const dataDir = getProjectSessionsDir(resolved);

  const spawn = async (cfg: {
    projectId: string;
    prompt: string;
    sdlcTaskId: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; workspacePath?: string }> => {
    const session = await sessionManager.spawn({ projectId: cfg.projectId, prompt: cfg.prompt });
    updateMetadata(dataDir, session.id, cfg.metadata);
    return { id: session.id, workspacePath: session.workspacePath ?? undefined };
  };

  // Adapter for the session-backed lens/plan runners: spawn tags SDLC metadata,
  // kill tears the session down once its sentinel output has been read.
  const sessionSpawn: SdlcSessionSpawn = {
    spawn: async ({ prompt, metadata }) => {
      const session = await sessionManager.spawn({ projectId: resolved, prompt });
      updateMetadata(dataDir, session.id, metadata);
      return { id: session.id, workspacePath: session.workspacePath ?? undefined };
    },
    kill: async (id) => {
      await sessionManager.kill(id);
    },
  };

  const waitForDone = async (sessionId: string): Promise<"done" | "failed"> => {
    const deadline = Date.now() + TASK_POLL_TIMEOUT_MS;
    for (;;) {
      const session = await sessionManager.get(sessionId);
      if (session) {
        const outcome = classifyTerminal(session);
        if (outcome) return outcome;
      }
      if (Date.now() > deadline) return "failed";
      await new Promise((resolve) => setTimeout(resolve, TASK_POLL_INTERVAL_MS));
    }
  };

  const engine = new WorkflowEngine({
    store,
    definitions: { [CA_PLAN_TO_BACKEND.name]: CA_PLAN_TO_BACKEND },
    executors: {
      "normalize-plan": makeNormalizePlanExecutor({
        // Draft the tm-style plan in a real worker session; the agent writes the
        // plan markdown to a sentinel file the runner reads. No session is
        // spawned when the input is already a structured Task Graph.
        adaptToPlan: makeInputAdapter(makeSessionPlanRunner(sessionSpawn)),
      }),
      "generate-backend": makeGenerateBackendExecutor({
        spawn,
        waitForDone,
        projectId: resolved,
      }),
    },
    gates: {
      // Run the tactical lens as a real, interactive AO worker session (visible
      // and attachable on the board) instead of a headless `claude -p`. The
      // session writes its verdict JSON to a sentinel file the runner reads.
      tactical: makeLensGate("tactical", loadLensPrompt("tactical"), makeSessionLensRunner(sessionSpawn)),
      "pattern-library": makePatternLibraryGate((artifactRef) => smokeEvalArtifact(artifactRef)),
    },
  });

  return { engine, store };
}
