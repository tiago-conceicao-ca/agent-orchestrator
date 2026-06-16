"use client";

import { useCallback, useState } from "react";
import type { RunActionKind, RunView } from "@/lib/sdlc-board";

// Shared run-action dispatcher for the SDLC views. Posts to the run-action API
// (approve via /api/sdlc/approve, the rest via /api/sdlc/runs/[id]/{action}),
// tracks per-run/per-action in-flight state to disable buttons, surfaces the
// server's error message, and re-polls via `onRefresh` (optimistic refresh).

const ALL_ACTIONS: RunActionKind[] = ["approve", "resume", "abandon"];

function actionKey(runId: string, action: RunActionKind): string {
  return `${runId}|${action}`;
}

function retryKey(runId: string, taskId: string): string {
  return `${runId}|retry|${taskId}`;
}

export function useSdlcRunActions(onRefresh: () => void) {
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  // Run a single POST under a busy key: skip if already in flight, surface the
  // server message on failure, always clear the key and re-poll.
  const run = useCallback(
    async (key: string, url: string, body: Record<string, unknown>, verb: string) => {
      let alreadyBusy = false;
      setBusy((current) => {
        if (current.has(key)) {
          alreadyBusy = true;
          return current;
        }
        return new Set(current).add(key);
      });
      if (alreadyBusy) return;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
        setActionError(!res.ok || data.ok === false ? (data.message ?? `Failed to ${verb}`) : null);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : `Failed to ${verb}`);
      } finally {
        setBusy((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        onRefresh();
      }
    },
    [onRefresh],
  );

  const dispatch = useCallback(
    (runView: RunView, action: RunActionKind) => {
      const url =
        action === "approve"
          ? "/api/sdlc/approve"
          : `/api/sdlc/runs/${encodeURIComponent(runView.id)}/${action}`;
      const body =
        action === "approve"
          ? { runId: runView.id, project: runView.projectId }
          : { project: runView.projectId };
      return run(actionKey(runView.id, action), url, body, `${action} run`);
    },
    [run],
  );

  const retryTask = useCallback(
    (runView: RunView, taskId: string) =>
      run(
        retryKey(runView.id, taskId),
        `/api/sdlc/runs/${encodeURIComponent(runView.id)}/retry`,
        { project: runView.projectId, taskId },
        `retry task ${taskId}`,
      ),
    [run],
  );

  const busyActionsFor = useCallback(
    (runId: string): Set<RunActionKind> =>
      new Set(ALL_ACTIONS.filter((action) => busy.has(actionKey(runId, action)))),
    [busy],
  );

  const isRetrying = useCallback(
    (runId: string, taskId: string): boolean => busy.has(retryKey(runId, taskId)),
    [busy],
  );

  return { dispatch, retryTask, busyActionsFor, isRetrying, actionError };
}
