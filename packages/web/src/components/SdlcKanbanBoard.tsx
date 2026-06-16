"use client";

import { COLUMNS, type Board, type BoardColumn, type KanbanCard } from "@/lib/sdlc-board";
import { SdlcStatusBadge } from "./SdlcTaskDetail";

// The read-only 6-column SDLC task kanban. Extracted so the per-run detail page
// reuses the exact columns the runs list used to render inline (no duplication).

const COLUMN_LABEL: Record<BoardColumn, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
};

export function SdlcKanbanBoard({
  board,
  onSelectTask,
}: {
  board: Board;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <div className="kanban-board-wrap">
      <div className="sdlc-kanban-board">
        {COLUMNS.map((column) => (
          <SdlcColumn
            key={column}
            column={column}
            cards={board[column]}
            onSelectTask={onSelectTask}
          />
        ))}
      </div>
    </div>
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
