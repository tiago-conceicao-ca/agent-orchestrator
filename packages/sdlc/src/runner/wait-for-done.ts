import { classifyTaskSentinel } from "./task-sentinel.js";

/** Outcome of waiting for a task worker to complete. */
export type TaskOutcome = "done" | "failed" | "stalled";

export interface WaitForTaskParams {
  /** The spawned worker session id (used only by `classifySession`). */
  sessionId: string;
  /** Worker workspace, where the completion sentinel is read from. */
  workspacePath?: string;
  /**
   * PR/lifecycle fallback: classify the session's terminal state, or `null` to
   * keep polling. Consulted only when the sentinel is absent.
   */
  classifySession: (sessionId: string) => Promise<"done" | "failed" | null>;
  /** Hard safety cap; on reach → "failed". */
  timeoutMs: number;
  /**
   * Stall threshold; on reach without a terminal signal → "stalled" (distinct
   * from the hard timeout so the engine can auto-retry). Omit to disable stall
   * detection (poll until `timeoutMs`).
   */
  stallThresholdMs?: number;
  pollIntervalMs: number;
  /** Injectable seams for deterministic tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Override the sentinel reader (tests). */
  readSentinel?: (workspacePath: string | undefined) => "done" | "failed" | null;
}

/**
 * Poll for a worker task's completion, sentinel FIRST.
 *
 * Each cycle: (1) read the `.ao/sdlc-task-done.json` sentinel — `ok:true`→done,
 * `ok:false`→failed; (2) absent → fall back to PR/lifecycle classification;
 * (3) past the stall threshold with no signal → "stalled"; (4) past the hard cap
 * → "failed". Preserves the original PR-based completion path as a fallback.
 */
export async function waitForTaskCompletion(params: WaitForTaskParams): Promise<TaskOutcome> {
  const now = params.now ?? Date.now;
  const sleep = params.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const readSentinel = params.readSentinel ?? classifyTaskSentinel;
  const start = now();
  const deadline = start + params.timeoutMs;
  const stallAt =
    params.stallThresholdMs !== undefined ? start + params.stallThresholdMs : undefined;

  for (;;) {
    // (1) Sentinel is the primary, PR-independent signal.
    const sentinel = readSentinel(params.workspacePath);
    if (sentinel) return sentinel;

    // (2) Fall back to PR/lifecycle detection (legacy completion path).
    const fallback = await params.classifySession(params.sessionId);
    if (fallback) return fallback;

    // (3) No progress signal past the stall threshold → surface a stall.
    if (stallAt !== undefined && now() >= stallAt) return "stalled";

    // (4) Hard safety cap.
    if (now() >= deadline) return "failed";

    await sleep(params.pollIntervalMs);
  }
}
