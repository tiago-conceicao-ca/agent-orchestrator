"use client";

import {
  COLUMNS,
  type BoardColumn,
  type KanbanCard,
  type RunView,
} from "@/lib/sdlc-board";
import { SdlcRunInsights } from "./SdlcRunInsights";
import { SdlcStatusBadge } from "./SdlcTaskDetail";

// One run's section in the SDLC run list: header (id/status/approve), the task
// kanban board, and the read-only run insights (phases, lens verdicts, plan).
// Split out of SdlcDashboard to keep that file within the 400-line cap (C-04).

const COLUMN_LABEL: Record<BoardColumn, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
};

function formatStatus(value: string): string {
  return value.replaceAll("_", " ");
}

export function SdlcRunSection({
  run,
  allProjectsView,
  isApproving,
  onApprove,
  onSelectTask,
}: {
  run: RunView;
  allProjectsView: boolean;
  isApproving: boolean;
  onApprove: (run: RunView) => void;
  onSelectTask: (taskId: string) => void;
}) {
  const awaitingApproval = run.status === "awaiting_approval";
  return (
    <section className="sdlc-run" data-run-status={run.status}>
      <header className="sdlc-run__header">
        <span className="sdlc-run__id">{run.id}</span>
        <span className="sdlc-run__status">{formatStatus(run.status)}</span>
        {allProjectsView ? <span className="sdlc-run__project">{run.projectId}</span> : null}
        {awaitingApproval ? (
          <button
            type="button"
            className="dashboard-app-btn dashboard-app-btn--primary ml-auto"
            disabled={isApproving}
            onClick={() => onApprove(run)}
          >
            {isApproving ? "Approving" : "Approve"}
          </button>
        ) : null}
      </header>
      <div className="kanban-board-wrap">
        <div className="sdlc-kanban-board">
          {COLUMNS.map((column) => (
            <SdlcColumn
              key={column}
              column={column}
              cards={run.board[column]}
              onSelectTask={onSelectTask}
            />
          ))}
        </div>
      </div>
      <SdlcRunInsights run={run} />
    </section>
  );
}

function SdlcColumn({
  column,
  cards,
  onSelectTask,
}: {
  column: BoardColumn;
  cards: KanbanCard[];
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <div className="kanban-column sdlc-kanban-column" data-sdlc-column={column}>
      <div className="kanban-column__header">
        <div className="kanban-column__title-row">
          <span className="kanban-column__title">{COLUMN_LABEL[column]}</span>
          <span className="kanban-column__count">{cards.length}</span>
        </div>
      </div>
      <div className="kanban-column-body">
        {cards.length > 0 ? (
          <div className="kanban-column__stack">
            {cards.map((card) => (
              <button
                key={card.taskId}
                type="button"
                className="sdlc-card"
                onClick={() => onSelectTask(card.taskId)}
                aria-label={`Open task T${card.number}: ${card.title}`}
              >
                <span className="sdlc-card__head">
                  <span className="sdlc-card__num">T{card.number}</span>
                  <SdlcStatusBadge status={card.status} />
                </span>
                <span className="sdlc-card__title">{card.title}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
