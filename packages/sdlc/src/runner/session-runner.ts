import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal session-manager surface the session-backed runner needs. The two
 * wirings (CLI `buildSdlcServices`, web `buildWebSdlcEngine`) adapt their real
 * SessionManager into this shape — `spawn` tags the SDLC metadata, `kill` tears
 * the session down once its output has been read.
 */
export interface SdlcSessionSpawn {
  /** Spawn a tagged session; returns its id + the worktree it runs in. */
  spawn(cfg: {
    prompt: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; workspacePath?: string | null }>;
  /** Best-effort teardown — the session has finished its single job. */
  kill(sessionId: string): Promise<void>;
}

export interface RunSessionBackedAgentParams {
  /** Full agent prompt. MUST instruct the agent to write its result to the sentinel as its final action. */
  prompt: string;
  /** Sentinel file basename under `{workspace}/.ao/`, e.g. `sdlc-output.json`. */
  sentinelName: string;
  /** Run id used to tag the session (`sdlcRunId`). */
  runId: string;
  /** Phase label used to tag the session (`sdlcPhase`), e.g. `lens:tactical`. */
  phase: string;
  /** Role used to tag the session (`sdlcRole`) so the board can label it. */
  role: "plan" | "lens";
  /** Completion time-box; defaults to 10 minutes. */
  timeoutMs?: number;
  /** Sentinel poll cadence; defaults to 2s. */
  pollIntervalMs?: number;
}

/** `.ao` subdirectory under the session workspace where the sentinel lives. */
const SENTINEL_DIR = ".ao";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000; // 10 min — matches the headless `claude -p` cap.
const DEFAULT_POLL_INTERVAL_MS = 2_000;

/**
 * Run an SDLC analysis step (plan write / lens review) as a real, interactive AO
 * worker session instead of a headless `claude -p` subprocess.
 *
 * Spawns a session tagged with `sdlcRunId`/`sdlcPhase`/`sdlcRole`, then polls for
 * the agent's sentinel output file (`{workspace}/.ao/{sentinelName}`) — the
 * deterministic completion signal for these PR-less sessions (they can't use
 * `classifyTerminal`, which needs a PR). On success it returns the file contents
 * (verdict JSON or plan markdown). On timeout, a missing workspace, or an empty
 * file it rejects so the engine's gate/executor try-catch marks the run failed.
 * The session is torn down best-effort in every path.
 */
export async function runSessionBackedAgent(
  sm: SdlcSessionSpawn,
  params: RunSessionBackedAgentParams,
): Promise<string> {
  const { prompt, sentinelName, runId, phase, role } = params;
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const { id, workspacePath } = await sm.spawn({
    prompt,
    metadata: { sdlcRunId: runId, sdlcPhase: phase, sdlcRole: role },
  });

  try {
    if (!workspacePath) {
      throw new Error(`SDLC ${role} session ${id} has no workspace path to read its output from.`);
    }
    const sentinelPath = join(workspacePath, SENTINEL_DIR, sentinelName);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (existsSync(sentinelPath)) {
        const contents = readFileSync(sentinelPath, "utf-8");
        if (contents.trim().length === 0) {
          throw new Error(
            `SDLC ${role} session ${id} wrote an empty ${sentinelName} output file.`,
          );
        }
        return contents;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `SDLC ${role} session ${id} did not produce ${sentinelName} within ${Math.round(
            timeoutMs / 1_000,
          )}s.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  } finally {
    // Best-effort teardown — the session has done its job (like a worker that
    // finished); it stays visible in run-view history.
    try {
      await sm.kill(id);
    } catch {
      /* ignore — teardown is best-effort */
    }
  }
}
