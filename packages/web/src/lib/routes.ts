export function projectDashboardPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function projectDashboardSessionPath(projectId: string, sessionId: string): string {
  return `${projectDashboardPath(projectId)}?session=${encodeURIComponent(sessionId)}`;
}

export function projectReviewPath(projectId: string | undefined): string {
  return projectId ? `/review?project=${encodeURIComponent(projectId)}` : "/review?project=all";
}

export function projectSdlcPath(projectId: string | undefined): string {
  return projectId ? `/sdlc?project=${encodeURIComponent(projectId)}` : "/sdlc?project=all";
}

export function sdlcRunPath(runId: string, projectId?: string): string {
  const base = `/sdlc/${encodeURIComponent(runId)}`;
  return projectId ? `${base}?project=${encodeURIComponent(projectId)}` : base;
}

export function projectSessionPath(projectId: string, sessionId: string): string {
  return `${projectDashboardPath(projectId)}/sessions/${encodeURIComponent(sessionId)}`;
}

export function projectSessionHashPath(projectId: string, sessionId: string, hash: string): string {
  return `${projectSessionPath(projectId, sessionId)}${hash}`;
}
