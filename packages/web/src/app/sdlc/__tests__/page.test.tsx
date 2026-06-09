import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SdlcPage from "../page";

const sampleRun = {
  id: "run-1",
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
};

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch(payload: unknown) {
  fetchMock = vi.fn(async () => ({ json: async () => payload }));
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
}

describe("SdlcPage", () => {
  beforeEach(() => {
    mockFetch({ runs: [sampleRun] });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the panel heading", () => {
    render(<SdlcPage />);
    expect(screen.getByText("SDLC Runs")).toBeInTheDocument();
  });

  it("renders a run's task cards once loaded", async () => {
    render(<SdlcPage />);
    await waitFor(() => expect(screen.getByText("Repo layer")).toBeInTheDocument());
    expect(screen.getByText("run-1")).toBeInTheDocument();
  });

  it("shows an empty state when there are no runs", async () => {
    mockFetch({ runs: [] });
    render(<SdlcPage />);
    await waitFor(() => expect(screen.getByText("No SDLC runs yet.")).toBeInTheDocument());
  });

  it("posts to the approve endpoint when Approve is clicked", async () => {
    render(<SdlcPage />);
    const button = await screen.findByRole("button", { name: "Approve" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/sdlc/approve",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
