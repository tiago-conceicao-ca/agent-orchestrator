"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSdlcRunActions } from "@/hooks/useSdlcRunActions";
import { MOBILE_BREAKPOINT, useMediaQuery } from "@/hooks/useMediaQuery";
import type { ProjectInfo } from "@/lib/project-name";
import { verdictSummary, type RunView } from "@/lib/sdlc-board";
import {
  projectDashboardPath,
  projectReviewPath,
  projectSdlcPath,
} from "@/lib/routes";
import type { DashboardOrchestratorLink, DashboardPR, DashboardSession } from "@/lib/types";
import { ProjectSidebar } from "./ProjectSidebar";
import { SdlcKanbanBoard } from "./SdlcKanbanBoard";
import { SdlcPlanDetail, PhaseProgress } from "./SdlcPlanDetail";
import { SdlcRunActionButtons } from "./SdlcRunActionButtons";
import { SdlcTaskDetail } from "./SdlcTaskDetail";
import { SidebarContext } from "./workspace/SidebarContext";

// Per-run detail page (/sdlc/[id]). Own 3s poll on /api/sdlc/runs/[id] (separate
// from the 5s session SSE — C-14). Composes the run-level action buttons
// (Approve/Resume/Abandon), a run-level lastError banner, a compact phase
// summary, a clickable plan entry that opens the Plan-detail modal (full plan +
// phases + lens verdicts + append-only amend box), the reused 6-column kanban,
// and the existing task detail panel. An unknown id renders a not-found state;
// the page is deep-linkable (incl. abandoned runs).
const POLL_INTERVAL_MS = 3_000;

const STATUS_TONE: Record<string, string> = {
  running: "working",
  awaiting_approval: "review",
  completed: "merged",
  failed: "fail",
  abandoned: "neutral",
};

function humanize(value: string): string {
  const spaced = value.replaceAll("-", " ").replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface SdlcRunDetailProps {
  runId: string;
  projectId?: string;
  projectName: string;
  projects: ProjectInfo[];
  sidebarSessions?: DashboardSession[];
  orchestrators?: DashboardOrchestratorLink[];
  dashboardLoadError?: string;
}

const EMPTY_SESSIONS: DashboardSession[] = [];
const EMPTY_ORCHESTRATORS: DashboardOrchestratorLink[] = [];

export function SdlcRunDetail({
  runId,
  projectId,
  projectName,
  projects,
  sidebarSessions = EMPTY_SESSIONS,
  orchestrators = EMPTY_ORCHESTRATORS,
  dashboardLoadError,
}: SdlcRunDetailProps) {
  const [run, setRun] = useState<RunView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sdlc/runs/${encodeURIComponent(runId)}`);
      if (res.status === 404) {
        setNotFound(true);
        setRun(null);
        return;
      }
      const data = (await res.json()) as { run?: RunView; error?: string };
      if (data.error) {
        setError(data.error);
        return;
      }
      setError(null);
      setNotFound(false);
      setRun(data.run ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load run");
    }
  }, [runId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const {
    dispatch,
    retryTask,
    setTaskModel,
    amendPlan,
    busyActionsFor,
    isRetrying,
    isSettingModel,
    isAmending,
    actionError,
  } = useSdlcRunActions(load);

  const sessionsById = useMemo(
    () => new Map(sidebarSessions.map((s) => [s.id, s])),
    [sidebarSessions],
  );

  const selectedTask = useMemo(() => {
    if (!run || !selectedTaskId) return null;
    const task = run.tasks.find((t) => t.id === selectedTaskId);
    if (!task) return null;
    const linkedId = task.linkedSession?.sessionId;
    const linkedPR: DashboardPR | null = linkedId
      ? (sessionsById.get(linkedId)?.pr ?? null)
      : null;
    return { task, linkedPR };
  }, [run, selectedTaskId, sessionsById]);

  const codingHref = projectId ? projectDashboardPath(projectId) : "/?project=all";
  const reviewHref = projectReviewPath(projectId);
  const sdlcHref = projectSdlcPath(projectId);
  const headerProjectLabel = projectName ?? "SDLC";
  const loadError = error ?? actionError ?? dashboardLoadError ?? null;

  const handleToggleSidebar = () => {
    if (isMobile) {
      setMobileMenuOpen((current) => !current);
    } else {
      setSidebarCollapsed((current) => !current);
    }
  };

  return (
    <SidebarContext.Provider
      value={{ onToggleSidebar: handleToggleSidebar, mobileSidebarOpen: mobileMenuOpen }}
    >
      <div className="dashboard-app-shell">
        <header className="dashboard-app-header">
          <button
            type="button"
            className="dashboard-app-sidebar-toggle"
            onClick={handleToggleSidebar}
            aria-label="Toggle sidebar"
          >
            <svg
              width={isMobile ? "16" : "14"}
              height={isMobile ? "16" : "14"}
              fill="none"
              stroke="currentColor"
              strokeWidth={isMobile ? "2" : "1.75"}
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              {isMobile ? (
                <path d="M4 6h16M4 12h16M4 18h16" />
              ) : (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 3v18" />
                </>
              )}
            </svg>
          </button>
          <div className="dashboard-app-header__brand">
            <span className="dashboard-app-header__brand-dot" aria-hidden="true" />
            <span>CAHI</span>
          </div>
          <span className="dashboard-app-header__sep" aria-hidden="true" />
          <span className="dashboard-app-header__project">{headerProjectLabel}</span>
          <nav className="workspace-mode-switch" aria-label="Workspace mode">
            <Link href={codingHref} className="workspace-mode-switch__item">
              Coding
            </Link>
            <Link href={reviewHref} className="workspace-mode-switch__item">
              Reviews
            </Link>
            <Link
              href={sdlcHref}
              className="workspace-mode-switch__item workspace-mode-switch__item--active"
              aria-current="page"
            >
              SDLC
            </Link>
          </nav>
          <div className="dashboard-app-header__spacer" />
        </header>

        <div
          className={`dashboard-shell dashboard-shell--desktop${
            sidebarCollapsed ? " dashboard-shell--sidebar-collapsed" : ""
          }`}
        >
          <div className={`sidebar-wrapper${mobileMenuOpen ? " sidebar-wrapper--mobile-open" : ""}`}>
            <ProjectSidebar
              projects={projects}
              sessions={sidebarSessions}
              orchestrators={orchestrators}
              activeProjectId={projectId}
              activeSessionId={undefined}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
              onMobileClose={() => setMobileMenuOpen(false)}
            />
          </div>
          {mobileMenuOpen ? (
            <div className="sidebar-mobile-backdrop" onClick={() => setMobileMenuOpen(false)} />
          ) : null}

          <main className="dashboard-main dashboard-main--desktop review-dashboard-main">
            <div className="sdlc-detail-page__topbar">
              <Link href={projectSdlcPath(projectId)} className="sdlc-detail-page__back">
                ← All runs
              </Link>
            </div>

            {loadError ? (
              <div className="dashboard-alert mb-4 border border-[color-mix(in_srgb,var(--color-status-error)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-status-error)_10%,transparent)] px-3.5 py-2.5 text-[11px] text-[var(--color-status-error)]">
                {loadError}
              </div>
            ) : null}

            {notFound ? (
              <section className="review-empty-state">
                <div className="review-empty-state__title">Run not found</div>
                <p className="review-empty-state__body">
                  No SDLC run with id <span className="font-[var(--font-mono)]">{runId}</span> exists.
                </p>
                <Link href={projectSdlcPath(projectId)} className="review-empty-state__link">
                  Back to runs
                </Link>
              </section>
            ) : run ? (
              <>
                <div className="sdlc-detail-page__header">
                  <div className="sdlc-detail-page__heading">
                    <h1 className="sdlc-detail-page__id">{run.id}</h1>
                    <span
                      className="sdlc-status-badge"
                      data-tone={STATUS_TONE[run.status] ?? "neutral"}
                    >
                      <span className="sdlc-status-badge__dot" aria-hidden="true" />
                      {humanize(run.status)}
                    </span>
                  </div>
                  <div className="sdlc-detail-page__actions">
                    <SdlcRunActionButtons
                      run={run}
                      busyActions={busyActionsFor(run.id)}
                      onAction={dispatch}
                    />
                  </div>
                </div>

                {run.status === "failed" && run.lastError ? (
                  <div className="sdlc-detail-page__error">
                    <span className="sdlc-detail-page__error-phase">
                      {humanize(run.lastError.phase)}
                    </span>
                    <span>{run.lastError.message}</span>
                  </div>
                ) : null}

                <div className="flex flex-col gap-3 px-1 pt-3">
                  <PhaseProgress phases={run.phaseStates} />
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] px-3 py-2.5 text-left text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-bg-primary)]"
                    onClick={() => setPlanOpen(true)}
                  >
                    <span>Plan &amp; review history</span>
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>

                <section className="sdlc-detail-page__board">
                  <SdlcKanbanBoard board={run.board} onSelectTask={setSelectedTaskId} />
                </section>
              </>
            ) : (
              <p className="sdlc-detail-page__loading">Loading run…</p>
            )}
          </main>
        </div>

        {planOpen && run ? (
          <SdlcPlanDetail
            run={run}
            amendable={
              run.planArtifact !== null &&
              (run.status === "failed" || run.status === "awaiting_approval")
            }
            needsFixes={verdictSummary(run.verdicts).needsFixes > 0}
            saving={isAmending(run.id)}
            onSaveComment={(comment) => amendPlan(run, comment)}
            onClose={() => setPlanOpen(false)}
          />
        ) : null}

        {selectedTask && run ? (
          <SdlcTaskDetail
            task={selectedTask.task}
            runId={run.id}
            linkedSessionPR={selectedTask.linkedPR}
            onRetry={run.status === "failed" ? (taskId) => retryTask(run, taskId) : undefined}
            retrying={isRetrying(run.id, selectedTask.task.id)}
            onSetModel={(taskId, model) => setTaskModel(run, taskId, model)}
            settingModel={isSettingModel(run.id, selectedTask.task.id)}
            onClose={() => setSelectedTaskId(null)}
          />
        ) : null}
      </div>
    </SidebarContext.Provider>
  );
}
