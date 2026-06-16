"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { SdlcTaskDetail as SdlcTask } from "@/lib/sdlc-board";
import { getPRDotClass, getPRStatusLabel } from "@/lib/pr-status";
import { cn } from "@/lib/cn";
import type { DashboardPR } from "@/lib/types";

// Rich detail panel for a single SDLC task. Read-only by default — it renders
// the enriched data the runs API supplies (T-number, status, summary, acceptance
// criteria, dependencies, agent/model, timestamps, linked session, and the exact
// agent prompt). The per-run detail page may pass `onRetry` to expose a single
// recovery action (re-spawn this task's worker) when the run has failed.

// SDLC task statuses → the design system's status tones (DESIGN.md colour map).
const STATUS_TONE: Record<string, string> = {
  backlog: "neutral",
  ready: "ready",
  in_progress: "working",
  in_review: "review",
  done: "merged",
  blocked: "fail",
};

function formatStatus(value: string): string {
  return value.replaceAll("_", " ");
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Status dot + label, shared by the kanban card and this panel. */
export function SdlcStatusBadge({ status }: { status: string }) {
  return (
    <span className="sdlc-status-badge" data-tone={STATUS_TONE[status] ?? "neutral"}>
      <span className="sdlc-status-badge__dot" aria-hidden="true" />
      {formatStatus(status)}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sdlc-detail__section">
      <h3 className="sdlc-detail__section-title">{title}</h3>
      {children}
    </section>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sdlc-detail__meta-row">
      <dt className="sdlc-detail__meta-label">{label}</dt>
      <dd className="sdlc-detail__meta-value">{children}</dd>
    </div>
  );
}

/** Linked worker PR + CI status, tone-mapped identically to the coding board. */
function LinkedSessionPR({ pr }: { pr: DashboardPR }) {
  const label = getPRStatusLabel(pr);
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      className="sdlc-detail__link inline-flex items-center gap-1.5"
    >
      <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", getPRDotClass(pr))} />
      <span>PR #{pr.number}</span>
      {label ? (
        <span className="text-[var(--color-text-tertiary)]">· {label}</span>
      ) : null}
    </a>
  );
}

interface SdlcTaskDetailProps {
  task: SdlcTask;
  runId: string;
  /** Live PR/CI of the linked worker session, when one is dispatched (incl. terminal). */
  linkedSessionPR?: DashboardPR | null;
  /** When provided, shows a Retry button that re-spawns this task's worker. */
  onRetry?: (taskId: string) => void;
  /** Disables the Retry button while a retry is in flight. */
  retrying?: boolean;
  onClose: () => void;
}

export function SdlcTaskDetail({
  task,
  runId,
  linkedSessionPR,
  onRetry,
  retrying = false,
  onClose,
}: SdlcTaskDetailProps) {
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const agentLabel = task.model ? `${task.agent} · ${task.model}` : task.agent;

  return (
    <>
      <div className="sdlc-detail-backdrop" onClick={onClose} />
      <aside
        className="sdlc-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`Task T${task.number}: ${task.title}`}
      >
        <header className="sdlc-detail__header">
          <div className="sdlc-detail__heading">
            <span className="sdlc-detail__num">T{task.number}</span>
            <h2 className="sdlc-detail__title">{task.title}</h2>
          </div>
          <div className="sdlc-detail__header-actions">
            {onRetry ? (
              <button
                type="button"
                className="dashboard-app-btn dashboard-app-btn--amber"
                onClick={() => onRetry(task.id)}
                disabled={retrying}
              >
                {retrying ? "Retrying…" : "Retry task"}
              </button>
            ) : null}
            <button
              type="button"
              className="sdlc-detail__close"
              onClick={onClose}
              aria-label="Close task detail"
            >
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>

        <div className="sdlc-detail__body">
          <div className="sdlc-detail__badges">
            <SdlcStatusBadge status={task.status} />
            <span className="sdlc-detail__chip">{task.complexity}</span>
            <span className="sdlc-detail__chip">{task.tdd ? "TDD" : "No TDD"}</span>
            <span className="sdlc-detail__run-id">{runId}</span>
          </div>

          <Section title="Description">
            <p className="sdlc-detail__desc">{task.summary || "No description provided."}</p>
          </Section>

          <Section title="Acceptance criteria">
            {task.acceptanceCriteria.length ? (
              <ul className="sdlc-detail__checklist">
                {task.acceptanceCriteria.map((criterion, i) => (
                  <li key={i} className="sdlc-detail__check">
                    <svg
                      className="sdlc-detail__check-icon"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span>{criterion}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sdlc-detail__muted">No acceptance criteria.</p>
            )}
          </Section>

          <Section title="Dependencies">
            {task.dependsOn.length ? (
              <ul className="sdlc-detail__deps">
                {task.dependsOn.map((dep) => (
                  <li key={dep} className="sdlc-detail__dep">
                    {dep}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sdlc-detail__muted">No dependencies.</p>
            )}
          </Section>

          <dl className="sdlc-detail__meta">
            <Meta label="Agent">{agentLabel}</Meta>
            <Meta label="Created">
              <time dateTime={task.createdAt}>{formatTimestamp(task.createdAt)}</time>
            </Meta>
            <Meta label="Updated">
              <time dateTime={task.updatedAt}>{formatTimestamp(task.updatedAt)}</time>
            </Meta>
            <Meta label="Session">
              {task.linkedSession ? (
                <span className="flex flex-col items-start gap-1">
                  <Link href={task.linkedSession.projectSessionPath} className="sdlc-detail__link">
                    {task.linkedSession.sessionId}
                  </Link>
                  {linkedSessionPR ? <LinkedSessionPR pr={linkedSessionPR} /> : null}
                </span>
              ) : (
                <span className="sdlc-detail__muted">Not dispatched</span>
              )}
            </Meta>
          </dl>

          <section className="sdlc-detail__section">
            <button
              type="button"
              className="sdlc-detail__prompt-toggle"
              onClick={() => setPromptOpen((open) => !open)}
              aria-expanded={promptOpen}
            >
              <svg
                className={`sdlc-detail__chevron${promptOpen ? " sdlc-detail__chevron--open" : ""}`}
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              View Agent Prompt
            </button>
            {promptOpen ? <pre className="sdlc-detail__prompt">{task.prompt}</pre> : null}
          </section>
        </div>
      </aside>
    </>
  );
}
