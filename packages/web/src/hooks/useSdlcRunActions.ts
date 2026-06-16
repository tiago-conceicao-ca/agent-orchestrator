"use client";

import { useCallback, useState } from "react";
import type { RunActionKind, RunView } from "@/lib/sdlc-board";

// Shared run-action dispatcher for the SDLC views. Posts to the run-action API
// (approve via /api/sdlc/approve, the rest via /api/sdlc/runs/[id]/{action}),
// tracks per-run/per-action in-flight state to disable buttons, surfaces the
// server's error message, and re-polls via `onRefresh` (optimistic refresh).

const ALL_ACTIONS: RunActionKind[] = ["approve", "resume", "abandon"];

function key(runId: string, action: RunActionKind): string {
  return `${runId}|${action}`;
}

export function useSdlcRunActions(onRefresh: () => void) {
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const dispatch = useCallback(
    async (run: RunView, action: RunActionKind) => {
      const k = key(run.id, action);
      let alreadyBusy = false;
      setBusy((current) => {
        if (current.has(k)) {
          alreadyBusy = true;
          return current;
        }
        return new Set(current).add(k);
      });
      if (alreadyBusy) return;
      try {
        const url =
          action === "approve"
            ? "/api/sdlc/approve"
            : `/api/sdlc/runs/${encodeURIComponent(run.id)}/${action}`;
        const body =
          action === "approve"
            ? { runId: run.id, project: run.projectId }
            : { project: run.projectId };
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
        if (!res.ok || data.ok === false) {
          setActionError(data.message ?? `Failed to ${action} run`);
        } else {
          setActionError(null);
        }
      } catch (e) {
        setActionError(e instanceof Error ? e.message : `Failed to ${action} run`);
      } finally {
        setBusy((current) => {
          const next = new Set(current);
          next.delete(k);
          return next;
        });
        onRefresh();
      }
    },
    [onRefresh],
  );

  const busyActionsFor = useCallback(
    (runId: string): Set<RunActionKind> =>
      new Set(ALL_ACTIONS.filter((action) => busy.has(key(runId, action)))),
    [busy],
  );

  return { dispatch, busyActionsFor, actionError };
}
