import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SdlcDashboard } from "../SdlcDashboard";
import type { RunView } from "@/lib/sdlc-board";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sdlc",
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }),
}));

function makeRun(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    projectId: "my-app",
    workflow: "ca-plan-to-backend",
    status: "awaiting_approval",
    pendingApproval: { phaseId: "normalize-plan", since: "2026-06-08T00:00:00Z" },
    board: {
      backlog: [{ taskId: "epic-1__repo", title: "Repo layer", status: "backlog" }],
      ready: [],
      in_progress: [],
      in_review: [],
      done: [],
      blocked: [],
    },
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockRunsFetch(runs: RunView[]) {
  fetchMock = vi.fn(async (url: unknown) => {
    if (url === "/api/sdlc/approve") {
      return { ok: true, json: async () => ({ ok: true, message: "Approved; resuming." }) };
    }
    return { ok: true, json: async () => ({ runs }) };
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
}

const PROJECTS = [{ id: "my-app", name: "My App", path: "/tmp/my-app" }];

describe("SdlcDashboard", () => {
  beforeEach(() => {
    mockRunsFetch([makeRun()]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the integrated shell with the SDLC nav entry active", async () => {
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    expect(screen.getByRole("heading", { name: "My App SDLC" })).toBeInTheDocument();
    const sdlcLink = screen.getByRole("link", { name: "SDLC" });
    expect(sdlcLink).toHaveAttribute("href", "/sdlc?project=my-app");
    expect(sdlcLink).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Coding" })).toHaveAttribute("href", "/projects/my-app");
    expect(screen.getByRole("link", { name: "Reviews" })).toHaveAttribute(
      "href",
      "/review?project=my-app",
    );
    // Flush the on-mount poll so its state update lands inside act().
    await waitFor(() => expect(screen.getByText("run-1")).toBeInTheDocument());
  });

  it("renders a run's task cards and columns once the poll loads", async () => {
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    await waitFor(() => expect(screen.getByText("Repo layer")).toBeInTheDocument());
    expect(screen.getByText("run-1")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("In Review")).toBeInTheDocument();
  });

  it("shows an empty state when there are no runs", async () => {
    mockRunsFetch([]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    await waitFor(() => expect(screen.getByText("No SDLC runs yet")).toBeInTheDocument());
  });

  it("approves a run with its runId and project scope", async () => {
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    const button = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sdlc/approve",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ runId: "run-1", project: "my-app" }),
        }),
      ),
    );
  });

  it("scopes runs to the active project", async () => {
    mockRunsFetch([
      makeRun({ id: "run-1", projectId: "my-app" }),
      makeRun({
        id: "run-2",
        projectId: "other-app",
        board: {
          backlog: [{ taskId: "epic-2__svc", title: "Other service", status: "backlog" }],
          ready: [],
          in_progress: [],
          in_review: [],
          done: [],
          blocked: [],
        },
      }),
    ]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    await waitFor(() => expect(screen.getByText("run-1")).toBeInTheDocument());
    expect(screen.queryByText("run-2")).not.toBeInTheDocument();
    expect(screen.queryByText("Other service")).not.toBeInTheDocument();
  });
});
