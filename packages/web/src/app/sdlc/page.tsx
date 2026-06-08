"use client";

import { useEffect, useState } from "react";
import { COLUMNS, type BoardColumn, type RunView } from "@/lib/sdlc-board";

// Independent poller for SDLC runs. The existing session SSE (useSessionEvents, 5s)
// is untouched (C-14); this dashboard panel polls its own read-only endpoint.
const POLL_INTERVAL_MS = 3_000;

const COLUMN_LABEL: Record<BoardColumn, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
};

export default function SdlcPage() {
  const [runs, setRuns] = useState<RunView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/sdlc/runs");
        const data = (await res.json()) as { runs?: RunView[]; error?: string };
        if (!active) return;
        if (data.error) {
          setError(data.error);
          return;
        }
        setError(null);
        setRuns(data.runs ?? []);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to load runs");
      }
    };
    void load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="min-h-screen bg-[var(--color-bg-base)] p-6 text-[var(--color-text-primary)]">
      <h1 className="mb-4 text-xl font-semibold">SDLC Runs</h1>
      {error && <p className="mb-4 text-sm text-[var(--color-accent-red)]">{error}</p>}
      {runs.length === 0 ? (
        <p className="text-[var(--color-text-tertiary)]">No SDLC runs yet.</p>
      ) : (
        <div className="flex flex-col gap-6">
          {runs.map((run) => (
            <section
              key={run.id}
              className="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-card)] p-4"
            >
              <header className="mb-3 flex items-center gap-3">
                <span className="font-mono text-sm text-[var(--color-text-secondary)]">{run.id}</span>
                <span className="text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  {run.status}
                </span>
              </header>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                {COLUMNS.map((col) => (
                  <div key={col} className="rounded-md bg-[var(--color-bg-subtle)] p-2">
                    <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">
                      {COLUMN_LABEL[col]} ({run.board[col].length})
                    </h2>
                    <ul className="flex flex-col gap-1">
                      {run.board[col].map((card) => (
                        <li
                          key={card.taskId}
                          className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-card)] px-2 py-1 text-xs text-[var(--color-text-secondary)]"
                        >
                          {card.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
