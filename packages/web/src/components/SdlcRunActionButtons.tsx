"use client";

import { availableRunActions, type RunActionKind, type RunView } from "@/lib/sdlc-board";

// Contextual run-level action buttons, shared by the runs-list card and the
// per-run detail header so the available actions + styling never drift.

const ACTION_LABEL: Record<RunActionKind, string> = {
  approve: "Approve",
  resume: "Resume",
  abandon: "Abandon",
};

const ACTION_BTN_CLASS: Record<RunActionKind, string> = {
  approve: "dashboard-app-btn dashboard-app-btn--primary",
  resume: "dashboard-app-btn dashboard-app-btn--amber",
  abandon: "dashboard-app-btn dashboard-app-btn--danger",
};

export function SdlcRunActionButtons({
  run,
  busyActions,
  onAction,
}: {
  run: RunView;
  busyActions: Set<RunActionKind>;
  onAction: (run: RunView, action: RunActionKind) => void;
}) {
  return (
    <>
      {availableRunActions(run.status).map((action) => (
        <button
          key={action}
          type="button"
          className={ACTION_BTN_CLASS[action]}
          disabled={busyActions.has(action)}
          onClick={() => onAction(run, action)}
        >
          {busyActions.has(action) ? `${ACTION_LABEL[action]}…` : ACTION_LABEL[action]}
        </button>
      ))}
    </>
  );
}
