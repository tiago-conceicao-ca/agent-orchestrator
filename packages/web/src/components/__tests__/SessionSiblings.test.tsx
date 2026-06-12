import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DashboardSibling } from "@/lib/types";
import { MountedSiblings } from "../SessionSiblings";

function makeSibling(overrides: Partial<DashboardSibling> = {}): DashboardSibling {
  return {
    repo: "ds-front",
    path: "/wt/app-1__sib__ds-front",
    branch: "sib/app-1/ds-front",
    mode: "worktree",
    ...overrides,
  };
}

describe("MountedSiblings (read-only)", () => {
  it("renders repo and branch for each mounted sibling", () => {
    render(
      <MountedSiblings
        siblings={[makeSibling(), makeSibling({ repo: "shared-lib", branch: "master" })]}
      />,
    );
    expect(screen.getByText("ds-front")).toBeInTheDocument();
    expect(screen.getByText("sib/app-1/ds-front")).toBeInTheDocument();
    expect(screen.getByText("shared-lib")).toBeInTheDocument();
    expect(screen.getByText("master")).toBeInTheDocument();
  });

  it("marks readonly-symlink siblings with an 'ro' badge", () => {
    render(<MountedSiblings siblings={[makeSibling({ mode: "readonly-symlink" })]} />);
    expect(screen.getByText("ro")).toBeInTheDocument();
  });

  it("renders nothing when there are no siblings", () => {
    const { container } = render(<MountedSiblings siblings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers no mutation affordances — siblings are configured per project", () => {
    render(<MountedSiblings siblings={[makeSibling()]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
