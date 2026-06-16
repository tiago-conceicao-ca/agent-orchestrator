import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RunView } from "@/lib/sdlc-board";

const { loadRunView } = vi.hoisted(() => ({ loadRunView: vi.fn() }));
vi.mock("@/lib/sdlc-run-view", () => ({ loadRunView }));

import { GET } from "../runs/[id]/route";

function makeRunView(id: string): RunView {
  return {
    id,
    projectId: "my-app",
    workflow: "ca-plan-to-backend",
    status: "failed",
    pendingApproval: null,
    createdAt: "2026-06-09T00:00:00Z",
    board: { backlog: [], ready: [], in_progress: [], in_review: [], done: [], blocked: [] },
    tasks: [],
    phaseStates: [],
    verdicts: [],
    planArtifact: null,
    lastError: { phase: "normalize-plan", message: "boom" },
    prMode: "per-task",
  };
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/sdlc/runs/[id]", () => {
  beforeEach(() => {
    loadRunView.mockReset();
  });

  it("returns the enriched run when found", async () => {
    loadRunView.mockResolvedValue(makeRunView("run-1"));
    const res = await GET(new Request("http://localhost/api/sdlc/runs/run-1"), makeParams("run-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: RunView };
    expect(body.run.id).toBe("run-1");
    expect(body.run.lastError).toEqual({ phase: "normalize-plan", message: "boom" });
    expect(loadRunView).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 when the run is unknown", async () => {
    loadRunView.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/sdlc/runs/ghost"), makeParams("ghost"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 500 when the loader throws", async () => {
    loadRunView.mockRejectedValue(new Error("disk gone"));
    const res = await GET(new Request("http://localhost/api/sdlc/runs/run-1"), makeParams("run-1"));
    expect(res.status).toBe(500);
  });
});
