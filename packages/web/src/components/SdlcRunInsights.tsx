"use client";

import { useState } from "react";
import type { PhaseStateView, RunView, VerdictView } from "@/lib/sdlc-board";

// Read-only run insights surfaced beneath each run's kanban board: phase
// progress (normalize-plan → generate-backend), the lens-verdict history with
// issues + captured reasoning, and the normalized plan artifact the lenses
// reviewed. Pure presentation over the enriched RunView (no mutations).

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

function PhaseProgress({ phases }: { phases: PhaseStateView[] }) {
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

function PlanArtifact({ plan }: { plan: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        className="sdlc-detail__prompt-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="sdlc-plan-artifact"
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
        View normalized plan
      </button>
      {open ? (
        <pre id="sdlc-plan-artifact" className="sdlc-detail__prompt">
          {plan}
        </pre>
      ) : null}
    </div>
  );
}

export function SdlcRunInsights({ run }: { run: RunView }) {
  const hasInsights =
    run.phaseStates.length > 0 || run.verdicts.length > 0 || run.planArtifact !== null;
  if (!hasInsights) return null;
  return (
    <div className="flex flex-col gap-3 px-1 pt-3">
      <PhaseProgress phases={run.phaseStates} />
      <LensVerdicts verdicts={run.verdicts} />
      {run.planArtifact !== null ? <PlanArtifact plan={run.planArtifact} /> : null}
    </div>
  );
}
