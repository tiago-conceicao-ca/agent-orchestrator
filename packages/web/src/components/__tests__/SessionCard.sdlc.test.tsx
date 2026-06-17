import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionCard } from "../SessionCard";
import { makeSession } from "../../__tests__/helpers";

describe("SessionCard SDLC badge", () => {
  it("renders an SDLC badge linking to the run view when the session carries sdlc metadata", () => {
    render(
      <SessionCard
        session={makeSession({
          id: "cahi-7",
          projectId: "my-app",
          metadata: {
            sdlcRunId: "run-epic-1-abc",
            sdlcTaskId: "epic-1__repo",
            sdlcPhase: "generate-backend",
          },
        })}
      />,
    );

    const badge = screen.getByRole("link", { name: /SDLC run/i });
    expect(badge).toHaveAttribute("href", "/sdlc?project=my-app");
    // The compact task ref (short segment of sdlcTaskId) is shown.
    expect(badge).toHaveTextContent("repo");
  });

  it("does not render an SDLC badge for an ordinary worker session", () => {
    render(<SessionCard session={makeSession({ id: "cahi-3", metadata: {} })} />);

    expect(screen.queryByRole("link", { name: /SDLC run/i })).not.toBeInTheDocument();
  });
});
