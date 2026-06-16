import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SdlcRunDetail } from "../SdlcRunDetail";
import type { RunView, SdlcTaskDetail } from "@/lib/sdlc-board";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/sdlc/run-1",
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setTheme: vi.fn() }),
}));

function makeTask(overrides: Partial<SdlcTaskDetail> = {}): SdlcTaskDetail {
  return {
    number: 1,
    id: "epic-1__repo",
    title: "Repo layer",
    status: "blocked",
    summary: "Persist the aggregate via the repository.",
    acceptanceCriteria: ["repository saves the aggregate"],
    dependsOn: [],
    complexity: "LOW",
    tdd: true,
    agent: "claude-code",
    model: null,
    createdAt: "2026-06-08T00:00:00Z",
    updatedAt: "2026-06-08T00:00:00Z",
    prompt: "Run the /gerar-backend skill.\n\nTask: Repo layer",
    linkedSession: null,
    attempts: 1,
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
      backlog: [],
      ready: [],
      in_progress: [],
      in_review: [],
      done: [],
      blocked: [{ number: 1, taskId: "epic-1__repo", title: "Repo layer", status: "blocked" }],
    },
    tasks: [makeTask()],
    phaseStates: [
      { id: "normalize-plan", state: "passed" },
      { id: "generate-backend", state: "running" },
    ],
    verdicts: [
      {
        lens: "tactical",
        verdict: "needs_fixes",
        issues: [{ severity: "high", title: "Missing tests", detail: "Add unit tests." }],
        rawOutput: "reasoning",
      },
    ],
    planArtifact: "# Normalized Plan\n## Task Graph",
    lastError: null,
    prMode: "per-task",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch(run: RunView | null) {
  fetchMock = vi.fn(async (url: unknown, options?: { method?: string }) => {
    if (options?.method === "POST") {
      return { ok: true, status: 200, json: async () => ({ ok: true, message: "ok" }) };
    }
    if (run === null) {
      return { ok: false, status: 404, json: async () => ({ error: "Run not found." }) };
    }
    return { ok: true, status: 200, json: async () => ({ run }) };
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
}

const PROJECTS = [{ id: "my-app", name: "My App", path: "/tmp/my-app" }];

function renderDetail() {
  return render(
    <SdlcRunDetail runId="run-1" projectId="my-app" projectName="My App" projects={PROJECTS} />,
  );
}

describe("SdlcRunDetail", () => {
  beforeEach(() => {
    mockFetch(makeRun());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the run header, status, back link, and an Approve action", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText("run-1")).toBeInTheDocument());
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /All runs/ })).toHaveAttribute(
      "href",
      "/sdlc?project=my-app",
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abandon" })).toBeInTheDocument();
  });

  it("reuses the phase progress, lens verdicts, and the 6-column kanban", async () => {
    renderDetail();
    await waitFor(() => expect(screen.getByText("Normalize plan")).toBeInTheDocument());
    expect(screen.getByText("Generate backend")).toBeInTheDocument();
    expect(screen.getByText("tactical")).toBeInTheDocument();
    expect(screen.getByText("Missing tests")).toBeInTheDocument();
    // Kanban columns render (unlike the runs list cards).
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("In Review")).toBeInTheDocument();
  });

  it("surfaces the run-level lastError when failed", async () => {
    mockFetch(
      makeRun({
        status: "failed",
        pendingApproval: null,
        lastError: { phase: "normalize-plan", message: "Lens 'tactical' rejected: Missing tests" },
      }),
    );
    renderDetail();
    await waitFor(() =>
      expect(screen.getByText(/Lens 'tactical' rejected: Missing tests/)).toBeInTheDocument(),
    );
  });

  it("opens the task detail panel when a kanban card is clicked", async () => {
    renderDetail();
    const card = await screen.findByRole("button", { name: "Open task T1: Repo layer" });
    fireEvent.click(card);
    const panel = await screen.findByRole("dialog", { name: "Task T1: Repo layer" });
    expect(panel).toBeInTheDocument();
    expect(screen.getByText("Persist the aggregate via the repository.")).toBeInTheDocument();
  });

  it("dispatches resume for a failed run", async () => {
    mockFetch(makeRun({ status: "failed", pendingApproval: null }));
    renderDetail();
    const button = await screen.findByRole("button", { name: "Resume" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sdlc/runs/run-1/resume",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ project: "my-app" }) }),
      ),
    );
  });

  it("dispatches approve for an awaiting run", async () => {
    renderDetail();
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

  it("retries a task from the task panel on a failed run", async () => {
    mockFetch(makeRun({ status: "failed", pendingApproval: null }));
    renderDetail();
    const card = await screen.findByRole("button", { name: "Open task T1: Repo layer" });
    fireEvent.click(card);
    const retry = await screen.findByRole("button", { name: "Retry task" });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sdlc/runs/run-1/retry",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ project: "my-app", taskId: "epic-1__repo" }),
        }),
      ),
    );
  });

  it("does not expose task retry on a non-failed run", async () => {
    renderDetail();
    const card = await screen.findByRole("button", { name: "Open task T1: Repo layer" });
    fireEvent.click(card);
    await screen.findByRole("dialog", { name: "Task T1: Repo layer" });
    expect(screen.queryByRole("button", { name: "Retry task" })).not.toBeInTheDocument();
  });

  it("saves a plan comment on a failed run via the append-only amend-plan endpoint", async () => {
    mockFetch(makeRun({ status: "failed", pendingApproval: null }));
    renderDetail();
    const input = await screen.findByLabelText("Plan comment");
    fireEvent.change(input, { target: { value: "Please add integration tests." } });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sdlc/runs/run-1/amend-plan",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            project: "my-app",
            comment: "Please add integration tests.",
          }),
        }),
      ),
    );
  });

  it("hides the amend form once the run has completed", async () => {
    mockFetch(makeRun({ status: "completed", pendingApproval: null }));
    renderDetail();
    await waitFor(() => expect(screen.getByText("run-1")).toBeInTheDocument());
    expect(screen.queryByLabelText("Plan comment")).not.toBeInTheDocument();
  });

  it("still loads a deep-linked abandoned run and renders an Abandoned badge", async () => {
    mockFetch(makeRun({ status: "abandoned", pendingApproval: null }));
    renderDetail();
    await waitFor(() => expect(screen.getByText("run-1")).toBeInTheDocument());
    expect(screen.getByText("Abandoned")).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown run", async () => {
    mockFetch(null);
    renderDetail();
    await waitFor(() => expect(screen.getByText("Run not found")).toBeInTheDocument());
  });
});
