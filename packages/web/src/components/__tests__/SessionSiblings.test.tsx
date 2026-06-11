import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSibling } from "@/lib/types";
import {
  SessionSiblings,
  SiblingCatalogList,
  MountedSiblings,
  type SiblingCatalogEntry,
} from "../SessionSiblings";

const CATALOG: SiblingCatalogEntry[] = [
  { id: "ds-front", name: "Design System" },
  { id: "shared-lib", name: "Shared Lib" },
];

function makeSibling(overrides: Partial<DashboardSibling> = {}): DashboardSibling {
  return {
    repo: "ds-front",
    path: "/wt/app-1__sib__ds-front",
    branch: "sib/app-1/ds-front",
    mode: "worktree",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MountedSiblings (read-only)", () => {
  it("renders repo and branch for each mounted sibling", () => {
    render(<MountedSiblings siblings={[makeSibling(), makeSibling({ repo: "shared-lib", branch: "master" })]} />);
    expect(screen.getByText("ds-front")).toBeInTheDocument();
    expect(screen.getByText("sib/app-1/ds-front")).toBeInTheDocument();
    expect(screen.getByText("shared-lib")).toBeInTheDocument();
    expect(screen.getByText("master")).toBeInTheDocument();
  });

  it("renders nothing when there are no siblings", () => {
    const { container } = render(<MountedSiblings siblings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SiblingCatalogList (project header catalog)", () => {
  it("renders the available catalog entries", () => {
    render(<SiblingCatalogList catalog={CATALOG} />);
    expect(screen.getByText("Design System")).toBeInTheDocument();
    expect(screen.getByText("Shared Lib")).toBeInTheDocument();
  });

  it("renders nothing when the catalog is empty", () => {
    const { container } = render(<SiblingCatalogList catalog={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SessionSiblings (interactive)", () => {
  it("lists the mounted siblings", () => {
    render(<SessionSiblings sessionId="app-1" siblings={[makeSibling()]} catalog={CATALOG} />);
    expect(screen.getByText("ds-front")).toBeInTheDocument();
    expect(screen.getByText("sib/app-1/ds-front")).toBeInTheDocument();
  });

  it("shows the '+ sibling' button when the catalog has entries", () => {
    render(<SessionSiblings sessionId="app-1" siblings={[]} catalog={CATALOG} />);
    expect(screen.getByRole("button", { name: /sibling/i })).toBeInTheDocument();
  });

  it("hides the '+ sibling' button when the catalog is empty", () => {
    render(<SessionSiblings sessionId="app-1" siblings={[]} catalog={[]} />);
    expect(screen.queryByRole("button", { name: /sibling/i })).not.toBeInTheDocument();
  });

  it("opens a picker listing catalog repos not already mounted", () => {
    render(<SessionSiblings sessionId="app-1" siblings={[makeSibling()]} catalog={CATALOG} />);
    fireEvent.click(screen.getByRole("button", { name: /sibling/i }));
    // ds-front is already mounted → only shared-lib offered
    expect(screen.getByRole("menuitem", { name: /Shared Lib/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Design System/i })).not.toBeInTheDocument();
  });

  it("POSTs to mount a sibling when a picker entry is chosen", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ sibling: makeSibling({ repo: "shared-lib", branch: "sib/app-1/shared-lib" }) }),
    });

    render(<SessionSiblings sessionId="app-1" siblings={[]} catalog={CATALOG} />);
    fireEvent.click(screen.getByRole("button", { name: /sibling/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Shared Lib/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sessions/app-1/siblings");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ repo: "shared-lib" });
  });

  it("DELETEs to unmount a mounted sibling", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    render(<SessionSiblings sessionId="app-1" siblings={[makeSibling()]} catalog={CATALOG} />);
    fireEvent.click(screen.getByRole("button", { name: /unmount ds-front/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sessions/app-1/siblings?repo=ds-front");
    expect(init.method).toBe("DELETE");
  });

  it("surfaces an error when mounting fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Unknown sibling repo" }),
    });

    render(<SessionSiblings sessionId="app-1" siblings={[]} catalog={CATALOG} />);
    fireEvent.click(screen.getByRole("button", { name: /sibling/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Shared Lib/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown sibling repo");
  });
});
