import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("@/components/DirectTerminal", () => ({
  DirectTerminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`direct-terminal-${sessionId}`}>{sessionId}</div>
  ),
}));

vi.mock("@/components/Terminal", () => ({
  Terminal: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`legacy-terminal-${sessionId}`}>{sessionId}</div>
  ),
}));

describe("TerminalTestPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the terminal comparison and documentation content", async () => {
    searchParams = new URLSearchParams();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          sessions: [{ id: "cahi-orchestrator" }, { id: "cahi-20" }],
        }),
      })),
    );

    const { default: TerminalTestPage } = await import("./page");
    render(<TerminalTestPage />);

    expect(screen.getByText("Terminal Implementation Test & Documentation")).toBeInTheDocument();
    expect(screen.getByText(/Root Cause Analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/The Debugging Journey/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide side-by-side comparison/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("legacy-terminal-cahi-orchestrator")).toBeInTheDocument();
      expect(screen.getByTestId("direct-terminal-cahi-20")).toBeInTheDocument();
    });
  });

  it("shows the same-session warning when both panes target one session", async () => {
    searchParams = new URLSearchParams("session=cahi-20");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({
          sessions: [{ id: "cahi-20" }],
        }),
      })),
    );

    const { default: TerminalTestPage } = await import("./page");
    render(<TerminalTestPage />);

    expect(screen.getByText(/Using same session for both terminals/i)).toBeInTheDocument();
    expect(screen.getByText("?old_session=cahi-orchestrator&new_session=cahi-20")).toBeInTheDocument();
  });
});
