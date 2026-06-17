import type { AgentRunner } from "../gates/lens-gate.js";
import type { PlanWriteRunner } from "../phases/input-adapter.js";
import { runSessionBackedAgent, type SdlcSessionSpawn } from "./session-runner.js";

/** Sentinel basenames the agent writes under `{workspace}/.cahi/`. */
export const LENS_SENTINEL = "sdlc-output.json";
export const PLAN_SENTINEL = "sdlc-output.md";

/** Appended to a lens prompt: write the verdict JSON to the sentinel as the final action. */
const LENS_OUTPUT_INSTRUCTION =
  `\n\n---\nWhen you have finished the review, your FINAL action MUST be to write ONLY your ` +
  `verdict JSON object to the file \`.cahi/${LENS_SENTINEL}\` in your current working directory ` +
  `(create the \`.cahi\` directory if it does not exist). Do not print the verdict anywhere else.`;

/** Appended to a plan prompt: write the plan markdown to the sentinel as the final action. */
const PLAN_OUTPUT_INSTRUCTION =
  `\n\n---\nWhen the plan is complete, your FINAL action MUST be to write the FULL plan markdown ` +
  `to the file \`.cahi/${PLAN_SENTINEL}\` in your current working directory ` +
  `(create the \`.cahi\` directory if it does not exist).`;

/**
 * Build the lens-gate runner that evaluates a plan in a real, interactive CAHI
 * worker session. `makeLensGate` passes the lens-labelled phase (`lens:<name>`)
 * via `ctx`; the artifact path is already substituted into `prompt`.
 */
export function makeSessionLensRunner(sm: SdlcSessionSpawn, timeoutMs?: number): AgentRunner {
  return (prompt, _artifactRef, ctx) =>
    runSessionBackedAgent(sm, {
      prompt: prompt + LENS_OUTPUT_INSTRUCTION,
      sentinelName: LENS_SENTINEL,
      runId: ctx.runId,
      phase: ctx.phase,
      role: "lens",
      timeoutMs,
    });
}

/**
 * Build the plan-write runner that drafts the tm-style plan in a real CAHI worker
 * session. Wrapped by `makeInputAdapter`, which appends the Task-Graph hint and
 * retries; this runner spawns one session per attempt.
 */
export function makeSessionPlanRunner(sm: SdlcSessionSpawn, timeoutMs?: number): PlanWriteRunner {
  return (input, ctx) =>
    runSessionBackedAgent(sm, {
      prompt: input + PLAN_OUTPUT_INSTRUCTION,
      sentinelName: PLAN_SENTINEL,
      runId: ctx.runId,
      phase: ctx.phase,
      role: "plan",
      timeoutMs,
    });
}
