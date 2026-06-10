import "server-only";

import { getProjectSessionsDir, listMetadata, readMetadataRaw } from "@aoagents/ao-core";
import { previewTaskPrompt, type WorkflowRun } from "@aoagents/ao-sdlc";
import { projectSessionPath } from "@/lib/routes";
import {
  assignTaskNumbers,
  dependsOnTitles,
  type LinkedSession,
  type SdlcTaskDetail,
} from "@/lib/sdlc-board";

// Server-only enrichment for the SDLC detail panel. Keeps node/fs + the
// @aoagents/ao-sdlc value import (previewTaskPrompt) out of the client bundle —
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
  return (run.epic?.tasks ?? []).map((task) => {
    const info = linked.get(task.id) ?? null;
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
      model: info?.model ?? null,
      // No per-task mutation timestamp is persisted; the run's createdAt is the
      // only authoritative timestamp, so created/updated mirror it.
      createdAt: run.createdAt,
      updatedAt: run.createdAt,
      prompt: previewTaskPrompt(task),
      linkedSession: info?.link ?? null,
    };
  });
}
