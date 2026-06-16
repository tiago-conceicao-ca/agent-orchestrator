"use client";

import Link from "next/link";
import { taskTotals, verdictSummary, type RunActionKind, type RunView } from "@/lib/sdlc-board";
import { sdlcRunPath } from "@/lib/routes";
import { SdlcRunActionButtons } from "./SdlcRunActionButtons";

// One run summary card on the /sdlc runs list: status, compact phase progress,
// lens-verdict summary, run-level lastError (when failed), task counts, and the
// contextual run actions. The full kanban + plan + lens detail lives on the
// per-run page (/sdlc/[id]); this card never renders the board inline.

const PHASE_TONE: Record<string, string> = {
  pending: "neutral",
  running: "working",
  passed: "merged",
  failed: "fail",
};

const STATUS_TONE: Record<string, string> = {
  running: "working",
  awaiting_approval: "review",
  completed: "merged",
  failed: "fail",
};

function humanize(value: string): string {
  const spaced = value.replaceAll("-", " ").replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function SdlcRunCard({
  run,
  allProjectsView,
  busyActions,
  onAction,
}: {
  run: RunView;
  allProjectsView: boolean;
  /** Action kinds currently in flight for this run (disables their buttons). */
  busyActions: Set<RunActionKind>;
  onAction: (run: RunView, action: RunActionKind) => void;
}) {
  const totals = taskTotals(run.board);
  const verdicts = verdictSummary(run.verdicts);
  const href = sdlcRunPath(run.id, run.projectId);

  return (
    <article className="sdlc-run-card" data-run-status={run.status}>
      <header className="sdlc-run-card__header">
        <Link href={href} className="sdlc-run-card__id">
          {run.id}
        </Link>
        <span className="sdlc-status-badge" data-tone={STATUS_TONE[run.status] ?? "neutral"}>
          <span className="sdlc-status-badge__dot" aria-hidden="true" />
          {humanize(run.status)}
        </span>
        {allProjectsView ? <span className="sdlc-run-card__project">{run.projectId}</span> : null}
      </header>

      {run.phaseStates.length > 0 ? (
        <ol className="sdlc-run-card__phases">
          {run.phaseStates.map((phase) => (
            <li
              key={phase.id}
              className="sdlc-status-badge"
              data-tone={PHASE_TONE[phase.state] ?? "neutral"}
              title={`${humanize(phase.id)}: ${phase.state}`}
            >
              <span className="sdlc-status-badge__dot" aria-hidden="true" />
              {humanize(phase.id)}
            </li>
          ))}
        </ol>
      ) : null}

      <dl className="sdlc-run-card__meta">
        <div className="sdlc-run-card__meta-item">
          <dt>Tasks</dt>
          <dd>
            {totals.done}/{totals.total} done
            {totals.blocked > 0 ? ` · ${totals.blocked} blocked` : ""}
          </dd>
        </div>
        {run.verdicts.length > 0 ? (
          <div className="sdlc-run-card__meta-item">
            <dt>Reviews</dt>
            <dd>
              {verdicts.passed} passed
              {verdicts.needsFixes > 0 ? ` · ${verdicts.needsFixes} needs fixes` : ""}
            </dd>
          </div>
        ) : null}
      </dl>

      {run.status === "failed" && run.lastError ? (
        <p className="sdlc-run-card__error">
          <span className="sdlc-run-card__error-phase">{humanize(run.lastError.phase)}</span>
          {run.lastError.message}
        </p>
      ) : null}

      <div className="sdlc-run-card__actions">
        <Link href={href} className="dashboard-app-btn">
          Open
        </Link>
        <SdlcRunActionButtons run={run} busyActions={busyActions} onAction={onAction} />
      </div>
    </article>
  );
}
