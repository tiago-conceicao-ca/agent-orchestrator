import "server-only";

import { getProjectSessionsDir, listMetadata, readMetadataRaw } from "@contaazul/cahi-core";
import { previewTaskPrompt, type WorkflowRun } from "@contaazul/cahi-sdlc";
import { projectSessionPath } from "@/lib/routes";
import {
  assignTaskNumbers,
  dependsOnTitles,
  passVerdictLens,
  type LinkedSession,
  type SdlcTaskDetail,
  type TaskPassView,
} from "@/lib/sdlc-board";

// Server-only enrichment for the SDLC detail panel. Keeps node/fs + the
// @contaazul/cahi-sdlc value import (previewTaskPrompt) out of the client bundle —
// the pure number/dependency helpers live in sdlc-board.ts and run on both sides.

interface LinkedSessionInfo {
  link: LinkedSession;
  agent: string;
  model: string | null;
}

/**
 * Index a project's sessions by the SDLC task they were dispatched for. A task
 * is linked to the first session whose metadata `sdlcTaskId` equals the task id.
 */
export function linkedSessionsByTaskId(projectId: string): Map<string, LinkedSessionInfo> {
  const dir = getProjectSessionsDir(projectId);
  const byTask = new Map<string, LinkedSessionInfo>();
  for (const sessionId of listMetadata(dir)) {
    const raw = readMetadataRaw(dir, sessionId);
    const taskId = raw?.["sdlcTaskId"];
    if (!taskId || byTask.has(taskId)) continue;
    byTask.set(taskId, {
      link: { sessionId, projectId, projectSessionPath: projectSessionPath(projectId, sessionId) },
      agent: raw?.["agent"] ?? "claude-code",
      model: raw?.["model"] ?? null,
    });
  }
  return byTask;
}

/** Build the read-only, fully-enriched task list for a run (epic-task order). */
export function enrichRunTasks(
  run: WorkflowRun,
  linked: Map<string, LinkedSessionInfo>,
): SdlcTaskDetail[] {
  const numbers = assignTaskNumbers(run);
  // Latest verdict per pass lens (`impl:<taskId>:<role>`) — last write wins so a
  // pass that needs_fixes then passes shows its final verdict.
  const verdictByLens = new Map<string, string>();
  for (const v of run.verdicts ?? []) verdictByLens.set(v.lens, v.verdict);
  return (run.epic?.tasks ?? []).map((task) => {
    const info = linked.get(task.id) ?? null;
    const progress = run.taskProgress?.[task.id];
    const passes: TaskPassView[] = (task.passes ?? []).map((p) => ({
      role: p.role,
      name: p.name,
      model: p.model,
      verdict: verdictByLens.get(passVerdictLens(task.id, p.role)) ?? null,
    }));
    return {
      number: numbers[task.id] ?? 0,
      id: task.id,
      title: task.title,
      status: run.taskStatus[task.id] ?? task.status,
      summary: task.summary,
      acceptanceCriteria: task.acceptanceCriteria,
      dependsOn: dependsOnTitles(run, task.id),
      complexity: task.complexity,
      tdd: task.tdd,
      // The generate-backend phase always spawns claude-code; prefer the linked
      // session's recorded agent when the task was actually dispatched.
      agent: info?.agent ?? "claude-code",
      // The task's assigned model (complexity default or per-task override) is
      // authoritative pre-dispatch; fall back to the linked session's recorded
      // model only when the epic task has none.
      model: task.model ?? info?.model ?? null,
      // No per-task mutation timestamp is persisted; the run's createdAt is the
      // only authoritative timestamp, so created/updated mirror it.
      createdAt: run.createdAt,
      updatedAt: run.createdAt,
      prompt: previewTaskPrompt(task),
      linkedSession: info?.link ?? null,
      attempts: progress?.attempts ?? 0,
      stalled: progress?.stalled ?? false,
      passes,
    };
  });
}
