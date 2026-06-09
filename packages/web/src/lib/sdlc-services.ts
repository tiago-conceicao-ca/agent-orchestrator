import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getProjectDir,
  getProjectSessionsDir,
  updateMetadata,
  type Session,
} from "@aoagents/ao-core";
import {
  CA_PLAN_TO_BACKEND,
  makeGenerateBackendExecutor,
  makeInputAdapter,
  makeLensGate,
  makeNormalizePlanExecutor,
  makePatternLibraryGate,
  RunStore,
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

async function runClaudeHeadless(prompt: string): Promise<string> {
  const { stdout } = await execFileAsync("claude", ["-p", prompt], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

function classifyTerminal(session: Session): "done" | "failed" | null {
  if (session.lifecycle?.pr?.state === "merged") return "done";
  switch (session.status) {
    case "merged":
    case "done":
    case "cleanup":
      return "done";
    case "errored":
    case "killed":
    case "terminated":
      return "failed";
    default:
      return null;
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
  }): Promise<{ id: string }> => {
    const session = await sessionManager.spawn({ projectId: cfg.projectId, prompt: cfg.prompt });
    updateMetadata(dataDir, session.id, cfg.metadata);
    return { id: session.id };
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
      tactical: makeLensGate("tactical", "{artifact}", (prompt) => runClaudeHeadless(prompt)),
      "pattern-library": makePatternLibraryGate((artifactRef) =>
        runClaudeHeadless(
          `Run the pattern-library backend eval over the code in ${artifactRef} and output ONLY the JSON result: {"passed":boolean,"score":number,"findings":[{"severity":"high|medium|low","title":string,"detail":string}]}.`,
        ),
      ),
    },
  });

  return { engine, store };
}
