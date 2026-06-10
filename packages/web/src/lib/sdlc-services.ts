import "server-only";

import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";
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
  RunStore,
  smokeEvalArtifact,
  WorkflowEngine,
} from "@aoagents/ao-sdlc";
import { getServices } from "./services";

// Dashboard-side engine wiring. Intentionally mirrors the CLI's buildSdlcServices
// (packages/cli/src/commands/sdlc.ts) — the shared pure logic (executors, gates,
// engine) lives in @aoagents/ao-sdlc; only the service-access + agent runners are
// app-specific. A future refactor could hoist this factory into @aoagents/ao-sdlc.

const execFileAsync = promisify(execFile);
const TASK_POLL_INTERVAL_MS = 5_000;
const TASK_POLL_TIMEOUT_MS = 2 * 60 * 60 * 1_000; // 2h safety cap
const CLAUDE_HEADLESS_TIMEOUT_MS = 10 * 60 * 1_000; // 10min — bound a stalled `claude -p`

async function runClaudeHeadless(prompt: string, extraArgs: string[] = []): Promise<string> {
  // Time-box the call: a stalled `claude -p` (API hang, rate-limit backoff, auth
  // prompt) would otherwise block gate.evaluate → engine.advance forever. On
  // timeout execFile kills the child and rejects; the rejection propagates to the
  // engine's gate-loop try/catch so the run fails cleanly instead of hanging.
  const { stdout } = await execFileAsync("claude", ["-p", prompt, ...extraArgs], {
    maxBuffer: 10 * 1024 * 1024,
    timeout: CLAUDE_HEADLESS_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return stdout;
}

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
        adaptToPlan: makeInputAdapter((input) => runClaudeHeadless(input)),
      }),
      "generate-backend": makeGenerateBackendExecutor({
        spawn,
        waitForDone,
        projectId: resolved,
      }),
    },
    gates: {
      // Grant the lens agent read access to the artifact's directory (the plan is
      // written to os.tmpdir(), outside the spawned agent's CWD) and skip the
      // interactive permission prompt — otherwise its Read tool is denied and it
      // returns needs_fixes without ever evaluating the plan.
      tactical: makeLensGate("tactical", loadLensPrompt("tactical"), (prompt, artifactRef) =>
        runClaudeHeadless(prompt, [
          "--add-dir",
          dirname(artifactRef),
          "--dangerously-skip-permissions",
        ]),
      ),
      "pattern-library": makePatternLibraryGate((artifactRef) => smokeEvalArtifact(artifactRef)),
    },
  });

  return { engine, store };
}
