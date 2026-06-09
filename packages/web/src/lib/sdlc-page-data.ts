import "server-only";

import { isRestorable, isTerminalSession } from "@aoagents/ao-core";
import { getServices } from "@/lib/services";
import {
  getAllProjects,
  getPrimaryProjectId,
  getProjectName,
  type ProjectInfo,
} from "@/lib/project-name";
import { listDashboardOrchestrators, sessionToDashboard } from "@/lib/serialize";
import type { DashboardOrchestratorLink, DashboardSession } from "@/lib/types";

// Shell data for the integrated SDLC view. Mirrors getReviewPageData's sidebar
// portion (projects + sessions + orchestrators) so the kanban renders inside the
// dashboard chrome. SDLC runs themselves are NOT fetched here — SdlcDashboard
// polls /api/sdlc/runs on its own 3s interval (the existing data path).
interface SdlcPageData {
  sidebarSessions: DashboardSession[];
  orchestrators: DashboardOrchestratorLink[];
  projectName: string;
  projects: ProjectInfo[];
  selectedProjectId?: string;
  dashboardLoadError?: string;
}

function formatSdlcLoadError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message.split(/\r?\n/)[0]?.trim() || "Failed to load SDLC data.";
  }
  return "Failed to load SDLC data.";
}

export function getSdlcProjectName(projectFilter: string | undefined): string {
  if (projectFilter === "all") return "All Projects";
  const projects = getAllProjects();
  if (projectFilter) {
    const selectedProject = projects.find((project) => project.id === projectFilter);
    if (selectedProject) return selectedProject.name;
  }
  return getProjectName();
}

export function resolveSdlcProjectFilter(project?: string): string {
  if (project === "all") return "all";
  const projects = getAllProjects();
  if (project && projects.some((entry) => entry.id === project)) {
    return project;
  }
  return getPrimaryProjectId();
}

export async function getSdlcPageData(project?: string): Promise<SdlcPageData> {
  const projectFilter = resolveSdlcProjectFilter(project);
  const pageData: SdlcPageData = {
    sidebarSessions: [],
    orchestrators: [],
    projectName: getSdlcProjectName(projectFilter),
    projects: getAllProjects(),
    selectedProjectId: projectFilter === "all" ? undefined : projectFilter,
  };

  try {
    const { config, sessionManager } = await getServices();
    const projectIds =
      projectFilter === "all"
        ? Object.keys(config.projects)
        : config.projects[projectFilter]
          ? [projectFilter]
          : [];
    const allSessions = await sessionManager.listCached();
    const visibleSessions = allSessions.filter((session) => projectIds.includes(session.projectId));

    pageData.sidebarSessions = visibleSessions.map(sessionToDashboard);
    const visibleSessionsById = new Map(visibleSessions.map((session) => [session.id, session]));
    pageData.orchestrators = listDashboardOrchestrators(visibleSessions, config.projects).map(
      (orchestrator) => {
        const session = visibleSessionsById.get(orchestrator.id);
        return {
          ...orchestrator,
          status: session?.status ?? null,
          activity: session?.activity ?? null,
          runtimeState: session?.lifecycle.runtime.state ?? null,
          hasRuntime: session?.runtimeHandle !== null && session?.runtimeHandle !== undefined,
          isTerminal: session ? isTerminalSession(session) : false,
          isRestorable: session ? isRestorable(session) : false,
        };
      },
    );
  } catch (err) {
    pageData.dashboardLoadError = formatSdlcLoadError(err);
  }

  return pageData;
}
