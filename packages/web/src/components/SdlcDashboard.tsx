"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MOBILE_BREAKPOINT, useMediaQuery } from "@/hooks/useMediaQuery";
import type { ProjectInfo } from "@/lib/project-name";
import {
  COLUMNS,
  filterRunsByProject,
  type BoardColumn,
  type KanbanCard,
  type RunView,
} from "@/lib/sdlc-board";
import { projectDashboardPath, projectReviewPath, projectSdlcPath } from "@/lib/routes";
import type { DashboardOrchestratorLink, DashboardSession } from "@/lib/types";
import { ProjectSidebar } from "./ProjectSidebar";
import { SidebarContext } from "./workspace/SidebarContext";

// Independent poller for SDLC runs. The session SSE (useSessionEvents, 5s) is
// untouched (C-14); this view keeps the standalone page's own 3s poll against
// the read-only /api/sdlc/runs endpoint.
const POLL_INTERVAL_MS = 3_000;

const COLUMN_LABEL: Record<BoardColumn, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
};

interface SdlcDashboardProps {
  sidebarSessions?: DashboardSession[];
  orchestrators?: DashboardOrchestratorLink[];
  projectId?: string;
  projectName: string;
  projects: ProjectInfo[];
  dashboardLoadError?: string;
}

const EMPTY_SESSIONS: DashboardSession[] = [];
const EMPTY_ORCHESTRATORS: DashboardOrchestratorLink[] = [];

function formatStatus(value: string): string {
  return value.replaceAll("_", " ");
}

export function SdlcDashboard({
  sidebarSessions = EMPTY_SESSIONS,
  orchestrators = EMPTY_ORCHESTRATORS,
  projectId,
  projectName,
  projects,
  dashboardLoadError,
}: SdlcDashboardProps) {
  const [runs, setRuns] = useState<RunView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [approvingIds, setApprovingIds] = useState<Set<string>>(() => new Set());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sdlc/runs");
      const data = (await res.json()) as { runs?: RunView[]; error?: string };
      if (data.error) {
        setError(data.error);
        return;
      }
      setError(null);
      setRuns(data.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load runs");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const approve = useCallback(
    async (run: RunView) => {
      if (approvingIds.has(run.id)) return;
      setApprovingIds((current) => new Set(current).add(run.id));
      try {
        await fetch("/api/sdlc/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: run.id, project: run.projectId }),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to approve run");
      } finally {
        setApprovingIds((current) => {
          const next = new Set(current);
          next.delete(run.id);
          return next;
        });
        void load();
      }
    },
    [approvingIds, load],
  );

  const visibleRuns = useMemo(() => filterRunsByProject(runs, projectId), [runs, projectId]);

  const allProjectsView = !projectId;
  const awaitingCount = visibleRuns.filter((run) => run.status === "awaiting_approval").length;
  const taskCount = visibleRuns.reduce(
    (sum, run) => sum + COLUMNS.reduce((n, col) => n + run.board[col].length, 0),
    0,
  );

  const codingHref = projectId ? projectDashboardPath(projectId) : "/?project=all";
  const reviewHref = projectReviewPath(projectId);
  const sdlcHref = projectSdlcPath(projectId);
  const headerProjectLabel = projectName ?? (allProjectsView ? "All projects" : "SDLC");
  const loadError = error ?? dashboardLoadError ?? null;

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
            {isMobile ? (
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
              </svg>
            )}
          </button>
          <div className="dashboard-app-header__brand">
            <span className="dashboard-app-header__brand-dot" aria-hidden="true" />
            <span>Agent Orchestrator</span>
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
          <div
            className={`sidebar-wrapper${mobileMenuOpen ? " sidebar-wrapper--mobile-open" : ""}`}
          >
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
            <div className="review-main-header">
              <div>
                <h1 className="dashboard-main__title">
                  {projectName ? `${projectName} SDLC` : "SDLC"}
                </h1>
                <p className="dashboard-main__subtitle">
                  SDLC workflow runs and their task kanban
                  {allProjectsView ? " across all projects" : " for this project"}.
                </p>
              </div>
              <div className="dashboard-stat-cards dashboard-stat-cards--persist-mobile">
                <SdlcMetric label="Runs" value={visibleRuns.length} meta="Total SDLC runs" />
                <SdlcMetric label="Awaiting" value={awaitingCount} meta="Runs awaiting approval" />
                <SdlcMetric label="Tasks" value={taskCount} meta="Tasks across runs" />
              </div>
            </div>

            {loadError ? (
              <div className="dashboard-alert mb-4 border border-[color-mix(in_srgb,var(--color-status-error)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-status-error)_10%,transparent)] px-3.5 py-2.5 text-[11px] text-[var(--color-status-error)]">
                {loadError}
              </div>
            ) : null}

            {visibleRuns.length === 0 ? (
              <section className="review-empty-state">
                <div className="review-empty-state__title">No SDLC runs yet</div>
                <p className="review-empty-state__body">
                  SDLC workflow runs will appear here once a run is started for
                  {allProjectsView ? " a project" : " this project"}.
                </p>
                <Link href={codingHref} className="review-empty-state__link">
                  Back to coding dashboard
                </Link>
              </section>
            ) : (
              <div className="sdlc-run-list">
                {visibleRuns.map((run) => (
                  <SdlcRunSection
                    key={`${run.projectId}:${run.id}`}
                    run={run}
                    allProjectsView={allProjectsView}
                    isApproving={approvingIds.has(run.id)}
                    onApprove={approve}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </SidebarContext.Provider>
  );
}

function SdlcMetric({ label, value, meta }: { label: string; value: number; meta: string }) {
  return (
    <div className="dashboard-stat-card">
      <span className="dashboard-stat-card__value">{value}</span>
      <span className="dashboard-stat-card__label">{label}</span>
      <span className="dashboard-stat-card__meta">{meta}</span>
    </div>
  );
}

function SdlcRunSection({
  run,
  allProjectsView,
  isApproving,
  onApprove,
}: {
  run: RunView;
  allProjectsView: boolean;
  isApproving: boolean;
  onApprove: (run: RunView) => void;
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
            <SdlcColumn key={column} column={column} cards={run.board[column]} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SdlcColumn({ column, cards }: { column: BoardColumn; cards: KanbanCard[] }) {
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
              <article key={card.taskId} className="sdlc-card">
                {card.title}
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
