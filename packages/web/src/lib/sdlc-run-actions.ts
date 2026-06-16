import type { WorkflowEngine, WorkflowRun } from "@aoagents/ao-sdlc";

/**
 * Pure run-action decisions that wrap the existing engine methods
 * (abandon/retryTask/resumeRun), mirroring `handleApprove` in sdlc-approve.ts.
 * Kept out of the route modules so Next.js route validation stays happy and the
 * state validation is unit-testable with a mocked engine. Each returns the HTTP
 * status the route should emit (404 unknown run, 409 invalid state, 200 ok).
 */
export interface RunActionResult {
  ok: boolean;
  status: number;
  message: string;
  /** The updated run, when the action ran. */
  run?: WorkflowRun;
}

function notFound(runId: string): RunActionResult {
  return { ok: false, status: 404, message: `Run '${runId}' not found.` };
}

/** Mark an in-progress run terminal. Invalid once the run is already terminal. */
export async function handleAbandon(
  engine: WorkflowEngine,
  runId: string,
): Promise<RunActionResult> {
  const run = await engine.load(runId);
  if (!run) return notFound(runId);
  if (run.status === "completed" || run.status === "failed")
    return {
      ok: false,
      status: 409,
      message: `Run is '${run.status}'; only an in-progress run can be abandoned.`,
    };
  const updated = await engine.abandon(runId);
  return { ok: true, status: 200, message: "Run abandoned.", run: updated };
}

/** Re-spawn a single task's worker. Only valid for a failed run with a known task. */
export async function handleRetry(
  engine: WorkflowEngine,
  runId: string,
  taskId: string | undefined,
): Promise<RunActionResult> {
  if (!taskId) return { ok: false, status: 400, message: "taskId is required." };
  const run = await engine.load(runId);
  if (!run) return notFound(runId);
  if (run.status !== "failed")
    return {
      ok: false,
      status: 409,
      message: `Run is '${run.status}'; retry is only available for failed runs.`,
    };
  const updated = await engine.retryTask(runId, taskId);
  return { ok: true, status: 200, message: `Retrying task ${taskId}.`, run: updated };
}

/**
 * Amend a run's plan with the user's comment and re-run normalize + lens in
 * place. Valid while the run has settled (not running) and isn't already
 * completed; the engine rejects a run with no plan to amend.
 */
export async function handleAmend(
  engine: WorkflowEngine,
  runId: string,
  comment: string | undefined,
): Promise<RunActionResult> {
  if (!comment || !comment.trim())
    return { ok: false, status: 400, message: "A comment is required to amend & re-run." };
  const run = await engine.load(runId);
  if (!run) return notFound(runId);
  if (run.status === "running")
    return {
      ok: false,
      status: 409,
      message: "Run is currently running; wait for it to settle before amending.",
    };
  if (run.status === "completed")
    return {
      ok: false,
      status: 409,
      message: "Run is completed; start a new run instead of amending.",
    };
  if (!run.planMarkdown)
    return { ok: false, status: 409, message: "Run has no plan to amend yet." };
  const updated = await engine.amendAndRerun(runId, comment.trim());
  return { ok: true, status: 200, message: "Amended; re-running normalize + lens.", run: updated };
}

/** Re-drive a failed run from a phase (or where it stalled). */
export async function handleResume(
  engine: WorkflowEngine,
  runId: string,
  fromPhase: string | undefined,
): Promise<RunActionResult> {
  const run = await engine.load(runId);
  if (!run) return notFound(runId);
  if (run.status !== "failed")
    return {
      ok: false,
      status: 409,
      message: `Run is '${run.status}'; resume is only available for failed runs.`,
    };
  const updated = await engine.resumeRun(runId, fromPhase ? { fromPhase } : {});
  return { ok: true, status: 200, message: "Resuming run.", run: updated };
}
