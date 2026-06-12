import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectSiblingsEditor,
  type SiblingCatalogEntry,
} from "../ProjectSiblingsEditor";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const CATALOG: SiblingCatalogEntry[] = [
  { id: "ds-front", name: "Design System" },
  { id: "shared-lib", name: "Shared Lib" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockRefresh.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProjectSiblingsEditor", () => {
  it("renders the configured siblings", () => {
    render(
      <ProjectSiblingsEditor
        projectId="app"
        siblings={[{ id: "ds-front", name: "Design System" }]}
        catalog={CATALOG}
      />,
    );
    expect(screen.getByText("Design System")).toBeInTheDocument();
  });

  it("renders nothing when there are no configured siblings and no catalog", () => {
    const { container } = render(
      <ProjectSiblingsEditor projectId="app" siblings={[]} catalog={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers only not-yet-configured projects in the picker", () => {
    render(
      <ProjectSiblingsEditor
        projectId="app"
        siblings={[{ id: "ds-front", name: "Design System" }]}
        catalog={CATALOG}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add sibling to app/i }));
    expect(screen.getByRole("menuitem", { name: /Shared Lib/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Design System/i })).not.toBeInTheDocument();
  });

  it("states that changes apply to new sessions only", () => {
    render(<ProjectSiblingsEditor projectId="app" siblings={[]} catalog={CATALOG} />);
    fireEvent.click(screen.getByRole("button", { name: /add sibling to app/i }));
    expect(screen.getByText(/applies to new sessions only/i)).toBeInTheDocument();
  });

  it("PATCHes the project with the updated array when a sibling is added", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    render(
      <ProjectSiblingsEditor
        projectId="app"
        siblings={[{ id: "ds-front", name: "Design System" }]}
        catalog={CATALOG}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add sibling to app/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Shared Lib/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/app");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ siblings: ["ds-front", "shared-lib"] });

    // Optimistic update: the new entry renders without waiting for the refresh.
    expect(await screen.findByText("Shared Lib")).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("PATCHes the project with the remaining array when a sibling is removed", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    render(
      <ProjectSiblingsEditor
        projectId="app"
        siblings={[
          { id: "ds-front", name: "Design System" },
          { id: "shared-lib", name: "Shared Lib" },
        ]}
        catalog={CATALOG}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove sibling Design System/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/projects/app");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ siblings: ["shared-lib"] });

    // Optimistic update: the removed entry disappears.
    await waitFor(() => {
      expect(screen.queryByText("Design System")).not.toBeInTheDocument();
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("surfaces an API error inline when adding fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Unknown sibling repo "shared-lib"' }),
    });

    render(<ProjectSiblingsEditor projectId="app" siblings={[]} catalog={CATALOG} />);
    fireEvent.click(screen.getByRole("button", { name: /add sibling to app/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Shared Lib/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown sibling repo");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("surfaces an API error inline when removing fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Failed to update project" }),
    });

    render(
      <ProjectSiblingsEditor
        projectId="app"
        siblings={[{ id: "ds-front", name: "Design System" }]}
        catalog={CATALOG}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove sibling Design System/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to update project");
    // The entry stays — removal was not applied.
    expect(screen.getByText("Design System")).toBeInTheDocument();
  });

  it("reconciles optimistic state when the siblings prop catches up", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const { rerender } = render(
      <ProjectSiblingsEditor projectId="app" siblings={[]} catalog={CATALOG} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add sibling to app/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Shared Lib/i }));
    // The picker closes on success; the optimistic entry renders in the list.
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByText("Shared Lib")).toBeInTheDocument();

    // Server refresh delivers the new configured list as props.
    rerender(
      <ProjectSiblingsEditor
        projectId="app"
        siblings={[{ id: "shared-lib", name: "Shared Lib" }]}
        catalog={CATALOG}
      />,
    );
    // Still rendered exactly once (prop entry, optimistic entry cleared).
    expect(screen.getAllByText("Shared Lib")).toHaveLength(1);
  });

  it("closes the picker on Escape", () => {
    render(<ProjectSiblingsEditor projectId="app" siblings={[]} catalog={CATALOG} />);
    fireEvent.click(screen.getByRole("button", { name: /add sibling to app/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
