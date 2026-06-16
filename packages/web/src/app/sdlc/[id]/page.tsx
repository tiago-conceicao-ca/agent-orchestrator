import type { Metadata } from "next";
import { SdlcRunDetail } from "@/components/SdlcRunDetail";
import { getSdlcPageData, resolveSdlcProjectFilter } from "@/lib/sdlc-page-data";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await props.params;
  return { title: { absolute: `ao | SDLC ${id}` } };
}

export default async function SdlcRunRoute(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ project?: string }>;
}) {
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const projectFilter = resolveSdlcProjectFilter(searchParams.project);
  const pageData = await getSdlcPageData(projectFilter);

  return (
    <SdlcRunDetail
      runId={id}
      projectId={pageData.selectedProjectId}
      projectName={pageData.projectName}
      projects={pageData.projects}
      sidebarSessions={pageData.sidebarSessions}
      orchestrators={pageData.orchestrators}
      dashboardLoadError={pageData.dashboardLoadError}
    />
  );
}
