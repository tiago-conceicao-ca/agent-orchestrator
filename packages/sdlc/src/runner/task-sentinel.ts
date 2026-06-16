import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Worker-task completion sentinel — the PR-independent "this task is done" signal.
 *
 * A generate-backend worker writes `{workspace}/.cahi/sdlc-task-done.json` as its
 * FINAL action. The engine treats this file as the primary completion signal,
 * falling back to PR/lifecycle detection (`classifyTerminal`) only when it is
 * absent. This decouples "task done" from per-session PR ownership, which breaks
 * the moment several tasks share one branch/PR (see the shared PR mode).
 *
 * Reuses the same `.cahi/<sentinel>.json` convention as the plan/lens session
 * runners (`runner/sdlc-agent-runners.ts`); this is the worker-task counterpart.
 */

/** Sentinel basename the worker writes under `{workspace}/.cahi/`. */
export const TASK_DONE_SENTINEL = "sdlc-task-done.json";

/** `.cahi` subdirectory under the session workspace where the sentinel lives. */
const SENTINEL_DIR = ".cahi";

/** Shape of the JSON a worker writes to signal task completion. */
export interface TaskDoneSentinel {
  /** true → task succeeded; false → task failed and the run must not advance. */
  ok: boolean;
  prNumber?: number;
  prUrl?: string;
  summary?: string;
}

/**
 * Read and parse the task-done sentinel from a worker's workspace.
 *
 * Returns `null` when the workspace/file is absent, empty, unparseable, or the
 * `ok` field is not a boolean — i.e. "no decisive signal yet, keep polling".
 */
export function readTaskSentinel(workspacePath: string | undefined): TaskDoneSentinel | null {
  if (!workspacePath) return null;
  const path = join(workspacePath, SENTINEL_DIR, TASK_DONE_SENTINEL);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  if (raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.ok !== "boolean") return null;
  const sentinel: TaskDoneSentinel = { ok: obj.ok };
  if (typeof obj.prNumber === "number") sentinel.prNumber = obj.prNumber;
  if (typeof obj.prUrl === "string") sentinel.prUrl = obj.prUrl;
  if (typeof obj.summary === "string") sentinel.summary = obj.summary;
  return sentinel;
}

/**
 * Classify the task-done sentinel into the engine's completion outcome.
 * `ok:true` → "done", `ok:false` → "failed", absent/invalid → `null` (keep polling).
 */
export function classifyTaskSentinel(workspacePath: string | undefined): "done" | "failed" | null {
  const sentinel = readTaskSentinel(workspacePath);
  if (!sentinel) return null;
  return sentinel.ok ? "done" : "failed";
}

/**
 * Instruction appended to a worker prompt telling it to write the completion
 * sentinel as its final action. `withPr` controls whether the worker is asked
 * to record its own PR number/url (per-task mode) or just a summary (shared mode).
 */
export function taskDoneSentinelInstruction(opts: { withPr: boolean }): string {
  const fields = opts.withPr
    ? `{ "ok": true, "prNumber": <number>, "prUrl": "<url>", "summary": "<one line>" }`
    : `{ "ok": true, "summary": "<one line>" }`;
  return (
    `When the task is complete, your FINAL action MUST be to write a JSON object to ` +
    `\`.cahi/${TASK_DONE_SENTINEL}\` in your current working directory (create the \`.cahi\` ` +
    `directory if it does not exist):\n${fields}\n` +
    `If you cannot complete the task, write \`{ "ok": false, "summary": "<why>" }\` instead. ` +
    `This file is how the orchestrator detects task completion — do not skip it.`
  );
}
