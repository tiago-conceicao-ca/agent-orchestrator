import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SdlcDashboard } from "../SdlcDashboard";
import type { RunView, SdlcTaskDetail } from "@/lib/sdlc-board";

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
    acceptanceCriteria: ["repository saves the aggregate"],
    dependsOn: [],
    complexity: "LOW",
    tdd: true,
    agent: "claude-code",
    model: null,
    createdAt: "2026-06-08T00:00:00Z",
    updatedAt: "2026-06-08T00:00:00Z",
    prompt: "Run the /gerar-backend skill to implement this task.\n\nTask: Repo layer",
    linkedSession: null,
    attempts: 0,
    stalled: false,
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
    lastError: null,
    prMode: "per-task",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockRunsFetch(runs: RunView[]) {
  fetchMock = vi.fn(async (url: unknown) => {
    if (typeof url === "string" && url !== "/api/sdlc/runs") {
      // Any action endpoint (approve / runs/:id/{abandon,resume}).
      return { ok: true, json: async () => ({ ok: true, message: "ok" }) };
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
    await waitFor(() => expect(screen.getByText("run-1")).toBeInTheDocument());
  });

  it("renders a run summary card with task counts and an Open link to the detail page", async () => {
    mockRunsFetch([
      makeRun({
        board: {
          backlog: [],
          ready: [],
          in_progress: [{ number: 1, taskId: "t1", title: "A", status: "in_progress" }],
          in_review: [],
          done: [{ number: 2, taskId: "t2", title: "B", status: "done" }],
          blocked: [{ number: 3, taskId: "t3", title: "C", status: "blocked" }],
        },
      }),
    ]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    await waitFor(() => expect(screen.getByText("run-1")).toBeInTheDocument());
    expect(screen.getByText(/1\/3 done/)).toBeInTheDocument();
    expect(screen.getByText(/1 blocked/)).toBeInTheDocument();
    const openLink = screen.getByRole("link", { name: "Open" });
    expect(openLink).toHaveAttribute("href", "/sdlc/run-1?project=my-app");
    // The kanban board is NOT rendered inline on the list anymore.
    expect(screen.queryByText("In Review")).not.toBeInTheDocument();
  });

  it("shows compact phase progress and a lens verdict summary on the card", async () => {
    mockRunsFetch([
      makeRun({
        phaseStates: [
          { id: "normalize-plan", state: "passed" },
          { id: "generate-backend", state: "running" },
        ],
        verdicts: [
          { lens: "tactical", verdict: "pass", issues: [], rawOutput: null },
          {
            lens: "pattern-library",
            verdict: "needs_fixes",
            issues: [{ severity: "high", title: "x", detail: "y" }],
            rawOutput: null,
          },
        ],
      }),
    ]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    await waitFor(() => expect(screen.getByText("Normalize plan")).toBeInTheDocument());
    expect(screen.getByText("Generate backend")).toBeInTheDocument();
    expect(screen.getByText(/1 passed/)).toBeInTheDocument();
    expect(screen.getByText(/1 needs fixes/)).toBeInTheDocument();
  });

  it("surfaces the run-level lastError on a failed run", async () => {
    mockRunsFetch([
      makeRun({
        status: "failed",
        lastError: { phase: "normalize-plan", message: "Lens 'tactical' rejected: Missing tests" },
      }),
    ]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    await waitFor(() =>
      expect(screen.getByText(/Lens 'tactical' rejected: Missing tests/)).toBeInTheDocument(),
    );
  });

  it("shows an empty state when there are no runs", async () => {
    mockRunsFetch([]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    await waitFor(() => expect(screen.getByText("No SDLC runs yet")).toBeInTheDocument());
  });

  it("approves an awaiting run with its runId and project scope", async () => {
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

  it("abandons a running run via the run-action endpoint", async () => {
    mockRunsFetch([makeRun({ status: "running", pendingApproval: null })]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    const button = await screen.findByRole("button", { name: "Abandon" });
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    fireEvent.click(button);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sdlc/runs/run-1/abandon",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ project: "my-app" }),
        }),
      ),
    );
  });

  it("resumes a failed run via the run-action endpoint", async () => {
    mockRunsFetch([makeRun({ status: "failed", pendingApproval: null })]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    const button = await screen.findByRole("button", { name: "Resume" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sdlc/runs/run-1/resume",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ project: "my-app" }),
        }),
      ),
    );
  });

  it("scopes runs to the active project", async () => {
    mockRunsFetch([
      makeRun({ id: "run-1", projectId: "my-app" }),
      makeRun({ id: "run-2", projectId: "other-app" }),
    ]);
    render(<SdlcDashboard projectId="my-app" projectName="My App" projects={PROJECTS} />);

    await waitFor(() => expect(screen.getByText("run-1")).toBeInTheDocument());
    expect(screen.queryByText("run-2")).not.toBeInTheDocument();
  });
});
