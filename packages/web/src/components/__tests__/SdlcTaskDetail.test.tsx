import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SdlcTaskDetail } from "../SdlcTaskDetail";
import type { SdlcTaskDetail as SdlcTask } from "@/lib/sdlc-board";

function makeTask(overrides: Partial<SdlcTask> = {}): SdlcTask {
  return {
    number: 3,
    id: "produto-kit__price-calc",
    title: "ProductKitPriceCalculator",
    status: "in_progress",
    summary: "Compute kit unit/total value from its composition.",
    acceptanceCriteria: ["sums component values", "rounds to two decimals"],
    dependsOn: ["ProductKitComposition entity"],
    complexity: "HIGH",
    tdd: true,
    agent: "claude-code",
    model: null,
    createdAt: "2026-06-09T14:52:16.743Z",
    updatedAt: "2026-06-09T14:52:16.743Z",
    prompt: "Run the /gerar-backend skill to implement this task.\n\nTask: ProductKitPriceCalculator",
    linkedSession: null,
    ...overrides,
  };
}

describe("SdlcTaskDetail", () => {
  it("renders the T-number, title, status, complexity, tdd, and description", () => {
    render(<SdlcTaskDetail task={makeTask()} runId="run-1" onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Task T3: ProductKitPriceCalculator" })).toBeInTheDocument();
    expect(screen.getByText("T3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ProductKitPriceCalculator" })).toBeInTheDocument();
    expect(screen.getByText("in progress")).toBeInTheDocument();
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("TDD")).toBeInTheDocument();
    expect(screen.getByText("Compute kit unit/total value from its composition.")).toBeInTheDocument();
  });

  it("renders the acceptance-criteria checklist and dependency titles", () => {
    render(<SdlcTaskDetail task={makeTask()} runId="run-1" onClose={vi.fn()} />);

    expect(screen.getByText("sums component values")).toBeInTheDocument();
    expect(screen.getByText("rounds to two decimals")).toBeInTheDocument();
    expect(screen.getByText("ProductKitComposition entity")).toBeInTheDocument();
  });

  it("shows the agent (and model when present)", () => {
    render(
      <SdlcTaskDetail task={makeTask({ model: "claude-opus-4-8" })} runId="run-1" onClose={vi.fn()} />,
    );
    expect(screen.getByText("claude-code · claude-opus-4-8")).toBeInTheDocument();
  });

  it("renders 'Not dispatched' when no session is linked", () => {
    render(<SdlcTaskDetail task={makeTask()} runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText("Not dispatched")).toBeInTheDocument();
  });

  it("renders the linked session as a dashboard link when dispatched", () => {
    render(
      <SdlcTaskDetail
        task={makeTask({
          linkedSession: {
            sessionId: "sci-1",
            projectId: "supply-chain",
            projectSessionPath: "/projects/supply-chain/sessions/sci-1",
          },
        })}
        runId="run-1"
        onClose={vi.fn()}
      />,
    );
    const link = screen.getByRole("link", { name: "sci-1" });
    expect(link).toHaveAttribute("href", "/projects/supply-chain/sessions/sci-1");
  });

  it("keeps the agent prompt collapsed until 'View Agent Prompt' is clicked", () => {
    render(<SdlcTaskDetail task={makeTask()} runId="run-1" onClose={vi.fn()} />);

    const toggle = screen.getByRole("button", { name: /View Agent Prompt/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Task: ProductKitPriceCalculator/)).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Task: ProductKitPriceCalculator/)).toBeInTheDocument();
  });

  it("calls onClose from the close button and on Escape", () => {
    const onClose = vi.fn();
    render(<SdlcTaskDetail task={makeTask()} runId="run-1" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close task detail" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
