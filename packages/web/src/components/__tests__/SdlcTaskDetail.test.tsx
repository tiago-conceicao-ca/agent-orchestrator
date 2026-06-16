import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SdlcTaskDetail } from "../SdlcTaskDetail";
import type { SdlcTaskDetail as SdlcTask } from "@/lib/sdlc-board";
import { makePR } from "@/__tests__/helpers";

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
    attempts: 0,
    stalled: false,
    passes: [],
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

  it("renders the graduated lens passes with names, models, and verdict status", () => {
    render(
      <SdlcTaskDetail
        task={makeTask({
          passes: [
            { role: "initial", name: "Initial Implementation", model: "sonnet", verdict: "pass" },
            { role: "correctness", name: "Correctness Review", model: "opus", verdict: "needs_fixes" },
            { role: "edge_cases", name: "Edge Case Review", model: "opus", verdict: null },
          ],
        })}
        runId="run-1"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Lens passes")).toBeInTheDocument();
    expect(screen.getByText("Initial Implementation")).toBeInTheDocument();
    expect(screen.getByText("Correctness Review")).toBeInTheDocument();
    expect(screen.getByText("needs fixes")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("omits the Lens passes section when a task has no expanded passes", () => {
    render(<SdlcTaskDetail task={makeTask({ passes: [] })} runId="run-1" onClose={vi.fn()} />);
    expect(screen.queryByText("Lens passes")).not.toBeInTheDocument();
  });

  it("renders the acceptance-criteria checklist and dependency titles", () => {
    render(<SdlcTaskDetail task={makeTask()} runId="run-1" onClose={vi.fn()} />);

    expect(screen.getByText("sums component values")).toBeInTheDocument();
    expect(screen.getByText("rounds to two decimals")).toBeInTheDocument();
    expect(screen.getByText("ProductKitComposition entity")).toBeInTheDocument();
  });

  it("shows the agent and a read-only model when no onSetModel is provided", () => {
    render(<SdlcTaskDetail task={makeTask({ model: "opus" })} runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText("claude-code")).toBeInTheDocument();
    expect(screen.getByText("opus")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Task model" })).not.toBeInTheDocument();
  });

  it("falls back to 'Project default' for a read-only model when the task has none", () => {
    render(<SdlcTaskDetail task={makeTask({ model: null })} runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText("Project default")).toBeInTheDocument();
  });

  it("renders a model selector reflecting the task's model when onSetModel is provided", () => {
    render(
      <SdlcTaskDetail
        task={makeTask({ model: "sonnet" })}
        runId="run-1"
        onSetModel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Task model" }) as HTMLSelectElement;
    expect(select.value).toBe("sonnet");
    expect(screen.getByRole("option", { name: "Project default" })).toBeInTheDocument();
    expect(screen.getByText(/Applies on the next dispatch\/retry/)).toBeInTheDocument();
  });

  it("calls onSetModel with the chosen model, and null for 'Project default'", () => {
    const onSetModel = vi.fn();
    render(
      <SdlcTaskDetail
        task={makeTask({ id: "t-1", model: "haiku" })}
        runId="run-1"
        onSetModel={onSetModel}
        onClose={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Task model" });
    fireEvent.change(select, { target: { value: "opus" } });
    expect(onSetModel).toHaveBeenCalledWith("t-1", "opus");
    fireEvent.change(select, { target: { value: "" } });
    expect(onSetModel).toHaveBeenCalledWith("t-1", null);
  });

  it("disables the model selector while a set-model request is in flight", () => {
    render(
      <SdlcTaskDetail
        task={makeTask()}
        runId="run-1"
        onSetModel={vi.fn()}
        settingModel
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Task model" })).toBeDisabled();
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

  it("renders the linked session's PR/CI status when provided", () => {
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
        linkedSessionPR={makePR({ number: 77, ciStatus: "failing", state: "open", enriched: true })}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: /sci-1/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PR #77/ })).toBeInTheDocument();
    expect(screen.getByText(/CI failing/)).toBeInTheDocument();
  });

  it("omits the PR/CI line when no linked PR is supplied", () => {
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
    expect(screen.getByRole("link", { name: /sci-1/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /PR #/ })).not.toBeInTheDocument();
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
