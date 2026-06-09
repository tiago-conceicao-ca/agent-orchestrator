import type { Metadata } from "next";
import { SdlcDashboard } from "@/components/SdlcDashboard";
import {
  getSdlcPageData,
  getSdlcProjectName,
  resolveSdlcProjectFilter,
} from "@/lib/sdlc-page-data";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  searchParams: Promise<{ project?: string }>;
}): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const projectFilter = resolveSdlcProjectFilter(searchParams.project);
  const projectName = getSdlcProjectName(projectFilter);
  return { title: { absolute: `ao | ${projectName} SDLC` } };
}

export default async function SdlcRoute(props: { searchParams: Promise<{ project?: string }> }) {
  const searchParams = await props.searchParams;
  const projectFilter = resolveSdlcProjectFilter(searchParams.project);
  const pageData = await getSdlcPageData(projectFilter);

  return (
    <SdlcDashboard
      projectId={pageData.selectedProjectId}
      projectName={pageData.projectName}
      projects={pageData.projects}
      sidebarSessions={pageData.sidebarSessions}
      orchestrators={pageData.orchestrators}
      dashboardLoadError={pageData.dashboardLoadError}
    />
  );
}
