import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SdlcDashboard } from "../SdlcDashboard";
import type { RunView, SdlcTaskDetail } from "@/lib/sdlc-board";
import { makePR, makeSession } from "@/__tests__/helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sdlc",
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }),
}));

function makeTask(overrides: Partial<SdlcTaskDetail> = {}): SdlcTaskDetail {
  return {
    number: 1,
    id: "epic-1__repo",
    title: "Repo layer",
    status: "backlog",
    summary: "Persist the aggregate via the repository.",
    acceptanceCriteria: ["repository saves the aggregate", "integration test passes"],
    dependsOn: [],
    complexity: "LOW",
    tdd: true,
    agent: "claude-code",
    model: null,
    createdAt: "2026-06-08T00:00:00Z",
    updatedAt: "2026-06-08T00:00:00Z",
    prompt: "Run the /gerar-backend skill to implement this task.\n\nTask: Repo layer",
    linkedSession: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    projectId: "my-app",
    workflow: "ca-plan-to-backend",
    status: "awaiting_approval",
    pendingApproval: { phaseId: "normalize-plan", since: "2026-06-08T00:00:00Z" },
    createdAt: "2026-06-08T00:00:00Z",
    board: {
      backlog: [{ number: 1, taskId: "epic-1__repo", title: "Repo layer", status: "backlog" }],
      ready: [],
      in_progress: [],
      in_review: [],
      done: [],
      blocked: [],
    },
    tasks: [makeTask()],
    phaseStates: [],
    verdicts: [],
    planArtifact: null,
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
    // Card shows its T-number.
    expect(screen.getByText("T1")).toBeInTheDocument();
  });

  it("opens the read-only detail panel when a task card is clicked", async () => {
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    const card = await screen.findByRole("button", { name: "Open task T1: Repo layer" });
    fireEvent.click(card);

    const panel = await screen.findByRole("dialog", { name: "Task T1: Repo layer" });
    expect(panel).toBeInTheDocument();
    // Detail content: description, an acceptance criterion, and the prompt toggle.
    expect(screen.getByText("Persist the aggregate via the repository.")).toBeInTheDocument();
    expect(screen.getByText("repository saves the aggregate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View Agent Prompt/ })).toBeInTheDocument();
    expect(screen.getByText("Not dispatched")).toBeInTheDocument();
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

  it("renders phase progress and the lens-verdict history with reasoning on expand", async () => {
    mockRunsFetch([
      makeRun({
        phaseStates: [
          { id: "normalize-plan", state: "passed" },
          { id: "generate-backend", state: "running" },
        ],
        verdicts: [
          {
            lens: "tactical",
            verdict: "needs_fixes",
            issues: [{ severity: "high", title: "Missing tests", detail: "Add unit tests." }],
            rawOutput: "Detailed lens reasoning here.",
          },
        ],
      }),
    ]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    await waitFor(() => expect(screen.getByText("Normalize plan")).toBeInTheDocument());
    expect(screen.getByText("Generate backend")).toBeInTheDocument();
    // Verdict + its issue render eagerly; reasoning is collapsed until expanded.
    expect(screen.getByText("tactical")).toBeInTheDocument();
    expect(screen.getByText("Missing tests")).toBeInTheDocument();
    expect(screen.getByText("Add unit tests.")).toBeInTheDocument();
    expect(screen.queryByText("Detailed lens reasoning here.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /View lens reasoning/ }));
    expect(screen.getByText("Detailed lens reasoning here.")).toBeInTheDocument();
  });

  it("surfaces the captured plan artifact behind a toggle", async () => {
    mockRunsFetch([makeRun({ planArtifact: "# Normalized Plan\n## Task Graph" })]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    const toggle = await screen.findByRole("button", { name: /View normalized plan/ });
    expect(screen.queryByText(/# Normalized Plan/)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText(/# Normalized Plan/)).toBeInTheDocument();
  });

  it("shows the linked worker's PR/CI status in the task detail (incl. terminal)", async () => {
    mockRunsFetch([
      makeRun({
        tasks: [
          makeTask({
            linkedSession: {
              sessionId: "ao-9",
              projectId: "my-app",
              projectSessionPath: "/projects/my-app/sessions/ao-9",
            },
          }),
        ],
      }),
    ]);
    render(
      <SdlcDashboard
        projectId="my-app"
        projectName="My App"
        projects={PROJECTS}
        sidebarSessions={[
          makeSession({
            id: "ao-9",
            projectId: "my-app",
            status: "killed",
            activity: "exited",
            pr: makePR({ number: 42, ciStatus: "failing", state: "open", enriched: true }),
          }),
        ]}
      />,
    );

    const card = await screen.findByRole("button", { name: "Open task T1: Repo layer" });
    fireEvent.click(card);

    const prLink = await screen.findByRole("link", { name: /PR #42/ });
    expect(prLink).toHaveAttribute("href", "https://github.com/acme/app/pull/100");
    expect(screen.getByText(/CI failing/)).toBeInTheDocument();
  });

  it("scopes runs to the active project", async () => {
    mockRunsFetch([
      makeRun({ id: "run-1", projectId: "my-app" }),
      makeRun({
        id: "run-2",
        projectId: "other-app",
        board: {
          backlog: [{ number: 1, taskId: "epic-2__svc", title: "Other service", status: "backlog" }],
          ready: [],
          in_progress: [],
          in_review: [],
          done: [],
          blocked: [],
        },
        tasks: [makeTask({ id: "epic-2__svc", title: "Other service" })],
      }),
    ]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    await waitFor(() => expect(screen.getByText("run-1")).toBeInTheDocument());
    expect(screen.queryByText("run-2")).not.toBeInTheDocument();
    expect(screen.queryByText("Other service")).not.toBeInTheDocument();
  });
});
