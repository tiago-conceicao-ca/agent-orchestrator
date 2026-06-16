import type { WorkflowEngine } from "@contaazul/cahi-sdlc";

/**
 * Pure approval decision: resume a run only if it is paused at a human gate.
 * Kept out of the route module so Next.js route validation (which forbids
 * non-route exports) stays happy and the logic is unit-testable.
 */
export async function handleApprove(
  engine: WorkflowEngine,
  runId: string,
): Promise<{ ok: boolean; message: string }> {
  const run = await engine.load(runId);
  if (!run) return { ok: false, message: "Run not found." };
  if (run.status !== "awaiting_approval")
    return { ok: false, message: `Run is '${run.status}', not awaiting approval.` };
  await engine.resume(runId);
  return { ok: true, message: "Approved; resuming." };
}
