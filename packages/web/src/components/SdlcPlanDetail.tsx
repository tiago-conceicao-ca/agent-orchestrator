"use client";

import { useEffect, useState } from "react";
import type { PhaseStateView, RunView, VerdictView } from "@/lib/sdlc-board";
import { SdlcAmendForm } from "./SdlcAmendForm";

// Right-slide Plan-detail modal (mirrors SdlcTaskDetail's pattern + Escape/close).
// Hosts the full plan text, the plan-details history moved out of the run page
// (phase progress + lens verdicts with issues + collapsible reasoning), and the
// append-only amend comment box. Saving a comment persists it to the plan; the
// orchestrator consumes it on the next Resume (the run header's Resume button).

function humanizePhase(id: string): string {
  const spaced = id.replaceAll("-", " ").replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const PHASE_TONE: Record<string, string> = {
  pending: "neutral",
  running: "working",
  passed: "merged",
  failed: "fail",
};

function GroupTitle({ children }: { children: string }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]">
      {children}
    </span>
  );
}

/** Phase badges in run order — reused as the run page's compact phase summary. */
export function PhaseProgress({ phases }: { phases: PhaseStateView[] }) {
  if (phases.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <GroupTitle>Phases</GroupTitle>
      <ol className="flex flex-wrap items-center gap-1.5">
        {phases.map((phase) => (
          <li
            key={phase.id}
            className="sdlc-status-badge"
            data-tone={PHASE_TONE[phase.state] ?? "neutral"}
            title={`${humanizePhase(phase.id)}: ${phase.state}`}
          >
            <span className="sdlc-status-badge__dot" aria-hidden="true" />
            {humanizePhase(phase.id)}
          </li>
        ))}
      </ol>
    </div>
  );
}

function VerdictCard({ verdict, index }: { verdict: VerdictView; index: number }) {
  const [open, setOpen] = useState(false);
  const passed = verdict.verdict === "pass";
  return (
    <li className="flex flex-col gap-1.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] p-2.5">
      <div className="flex items-center gap-2">
        <span className="sdlc-status-badge" data-tone={passed ? "merged" : "fail"}>
          <span className="sdlc-status-badge__dot" aria-hidden="true" />
          {verdict.lens}
        </span>
        <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
          {passed ? "pass" : "needs fixes"}
        </span>
      </div>
      {verdict.issues.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {verdict.issues.map((issue, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="shrink-0 rounded bg-[var(--color-bg-primary)] px-1 py-0.5 font-[var(--font-mono)] text-[9px] uppercase leading-none text-[var(--color-text-tertiary)]">
                {issue.severity}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[var(--color-text-primary)]">
                  {issue.title}
                </p>
                {issue.detail ? (
                  <p className="text-[11px] leading-snug text-[var(--color-text-tertiary)]">
                    {issue.detail}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {verdict.rawOutput ? (
        <>
          <button
            type="button"
            className="sdlc-detail__prompt-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={`verdict-reasoning-${index}`}
          >
            <svg
              className={`sdlc-detail__chevron${open ? " sdlc-detail__chevron--open" : ""}`}
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
            View lens reasoning
          </button>
          {open ? (
            <pre id={`verdict-reasoning-${index}`} className="sdlc-detail__prompt">
              {verdict.rawOutput}
            </pre>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

function LensVerdicts({ verdicts }: { verdicts: VerdictView[] }) {
  if (verdicts.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <GroupTitle>Lens reviews</GroupTitle>
      <ul className="flex flex-col gap-2">
        {verdicts.map((verdict, i) => (
          <VerdictCard key={`${verdict.lens}-${i}`} verdict={verdict} index={i} />
        ))}
      </ul>
    </div>
  );
}

interface SdlcPlanDetailProps {
  run: RunView;
  /** Whether the amend comment box is shown (run settled with a persisted plan). */
  amendable: boolean;
  /** True when a lens returned needs_fixes (tunes the amend hint). */
  needsFixes: boolean;
  /** Disables the amend box while a save is in flight. */
  saving: boolean;
  onSaveComment: (comment: string) => void;
  onClose: () => void;
}

export function SdlcPlanDetail({
  run,
  amendable,
  needsFixes,
  saving,
  onSaveComment,
  onClose,
}: SdlcPlanDetailProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="sdlc-detail-backdrop" onClick={onClose} />
      <aside className="sdlc-detail" role="dialog" aria-modal="true" aria-label={`Plan for ${run.id}`}>
        <header className="sdlc-detail__header">
          <div className="sdlc-detail__heading">
            <h2 className="sdlc-detail__title">Plan</h2>
          </div>
          <div className="sdlc-detail__header-actions">
            <button
              type="button"
              className="sdlc-detail__close"
              onClick={onClose}
              aria-label="Close plan detail"
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
            <span className="sdlc-detail__run-id">{run.id}</span>
          </div>

          <section className="sdlc-detail__section">
            <h3 className="sdlc-detail__section-title">Plan</h3>
            {run.planArtifact !== null ? (
              <pre className="sdlc-detail__prompt">{run.planArtifact}</pre>
            ) : (
              <p className="sdlc-detail__muted">No plan has been normalized yet.</p>
            )}
          </section>

          {run.phaseStates.length > 0 || run.verdicts.length > 0 ? (
            <section className="sdlc-detail__section">
              <h3 className="sdlc-detail__section-title">Plan details</h3>
              <div className="flex flex-col gap-3">
                <PhaseProgress phases={run.phaseStates} />
                <LensVerdicts verdicts={run.verdicts} />
              </div>
            </section>
          ) : null}

          {amendable ? (
            <SdlcAmendForm needsFixes={needsFixes} busy={saving} onSave={onSaveComment} />
          ) : null}
        </div>
      </aside>
    </>
  );
}
