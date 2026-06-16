import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SdlcPlanDetail } from "../SdlcPlanDetail";
import type { RunView } from "@/lib/sdlc-board";

function makeRun(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "run-1",
    projectId: "my-app",
    workflow: "ca-plan-to-backend",
    status: "failed",
    pendingApproval: null,
    createdAt: "2026-06-08T00:00:00Z",
    board: { backlog: [], ready: [], in_progress: [], in_review: [], done: [], blocked: [] },
    tasks: [],
    phaseStates: [
      { id: "normalize-plan", state: "passed" },
      { id: "generate-backend", state: "failed" },
    ],
    verdicts: [
      {
        lens: "tactical",
        verdict: "needs_fixes",
        issues: [{ severity: "high", title: "Missing tests", detail: "Add unit tests." }],
        rawOutput: "lens reasoning text",
      },
    ],
    planArtifact: "# Normalized Plan\n## Task Graph",
    lastError: null,
    prMode: "per-task",
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("SdlcPlanDetail", () => {
  it("renders the full plan text, phase progress, and lens verdicts", () => {
    render(
      <SdlcPlanDetail
        run={makeRun()}
        amendable
        needsFixes
        saving={false}
        onSaveComment={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Plan for run-1" })).toBeInTheDocument();
    expect(screen.getByText(/# Normalized Plan/)).toBeInTheDocument();
    expect(screen.getByText("Normalize plan")).toBeInTheDocument();
    expect(screen.getByText("tactical")).toBeInTheDocument();
    expect(screen.getByText("Missing tests")).toBeInTheDocument();
  });

  it("reveals the lens reasoning when toggled", () => {
    render(
      <SdlcPlanDetail
        run={makeRun()}
        amendable={false}
        needsFixes={false}
        saving={false}
        onSaveComment={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("lens reasoning text")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View lens reasoning" }));
    expect(screen.getByText("lens reasoning text")).toBeInTheDocument();
  });

  it("dispatches a saved comment via onSaveComment when amendable", () => {
    const onSaveComment = vi.fn();
    render(
      <SdlcPlanDetail
        run={makeRun()}
        amendable
        needsFixes
        saving={false}
        onSaveComment={onSaveComment}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Plan comment"), {
      target: { value: "Add integration tests." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));
    expect(onSaveComment).toHaveBeenCalledWith("Add integration tests.");
  });

  it("hides the amend box when not amendable", () => {
    render(
      <SdlcPlanDetail
        run={makeRun({ status: "completed" })}
        amendable={false}
        needsFixes={false}
        saving={false}
        onSaveComment={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Plan comment")).not.toBeInTheDocument();
  });

  it("closes on Escape and on the close button", () => {
    const onClose = vi.fn();
    render(
      <SdlcPlanDetail
        run={makeRun()}
        amendable
        needsFixes
        saving={false}
        onSaveComment={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close plan detail" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
