import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkflowEngine, WorkflowRun } from "@aoagents/ao-sdlc";

const { buildWebSdlcEngine } = vi.hoisted(() => ({ buildWebSdlcEngine: vi.fn() }));
vi.mock("@/lib/sdlc-services", () => ({ buildWebSdlcEngine }));

import { POST as abandonPOST } from "../runs/[id]/abandon/route";
import { POST as retryPOST } from "../runs/[id]/retry/route";
import { POST as resumePOST } from "../runs/[id]/resume/route";

function makeRun(status: WorkflowRun["status"]): WorkflowRun {
  return {
    id: "run-1",
    workflow: "ca-plan-to-backend",
    epicId: "epic-1",
    status,
    currentPhaseIndex: 0,
    phaseStates: {},
    taskStatus: {},
    verdicts: [],
    pendingApproval: null,
    createdAt: "2026-06-09T00:00:00Z",
  };
}

interface FakeEngine {
  load: ReturnType<typeof vi.fn>;
  abandon: ReturnType<typeof vi.fn>;
  retryTask: ReturnType<typeof vi.fn>;
  resumeRun: ReturnType<typeof vi.fn>;
}

function mockEngine(run: WorkflowRun | null): FakeEngine {
  const engine: FakeEngine = {
    load: vi.fn().mockResolvedValue(run),
    abandon: vi.fn().mockResolvedValue(run ? { ...run, status: "failed" } : null),
    retryTask: vi.fn().mockResolvedValue(run),
    resumeRun: vi.fn().mockResolvedValue(run ? { ...run, status: "completed" } : null),
  };
  buildWebSdlcEngine.mockResolvedValue({ engine: engine as unknown as WorkflowEngine });
  return engine;
}

function req(body: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/sdlc/runs/run-1/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: "run-1" }) };

beforeEach(() => {
  buildWebSdlcEngine.mockReset();
});

describe("POST /api/sdlc/runs/[id]/abandon", () => {
  it("abandons an in-progress run (200)", async () => {
    const engine = mockEngine(makeRun("running"));
    const res = await abandonPOST(req({ project: "my-app" }), params);
    expect(res.status).toBe(200);
    expect(engine.abandon).toHaveBeenCalledWith("run-1");
    expect((await res.json()).ok).toBe(true);
  });

  it("rejects a terminal run (409)", async () => {
    const engine = mockEngine(makeRun("completed"));
    const res = await abandonPOST(req(), params);
    expect(res.status).toBe(409);
    expect(engine.abandon).not.toHaveBeenCalled();
  });

  it("404s an unknown run", async () => {
    mockEngine(null);
    const res = await abandonPOST(req(), params);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/sdlc/runs/[id]/retry", () => {
  it("retries a task on a failed run (200)", async () => {
    const engine = mockEngine(makeRun("failed"));
    const res = await retryPOST(req({ taskId: "t-1" }), params);
    expect(res.status).toBe(200);
    expect(engine.retryTask).toHaveBeenCalledWith("run-1", "t-1");
  });

  it("400s when taskId is missing", async () => {
    const engine = mockEngine(makeRun("failed"));
    const res = await retryPOST(req(), params);
    expect(res.status).toBe(400);
    expect(engine.retryTask).not.toHaveBeenCalled();
  });

  it("rejects retry on a non-failed run (409)", async () => {
    const engine = mockEngine(makeRun("running"));
    const res = await retryPOST(req({ taskId: "t-1" }), params);
    expect(res.status).toBe(409);
    expect(engine.retryTask).not.toHaveBeenCalled();
  });

  it("404s an unknown run", async () => {
    mockEngine(null);
    const res = await retryPOST(req({ taskId: "t-1" }), params);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/sdlc/runs/[id]/resume", () => {
  it("resumes a failed run (200)", async () => {
    const engine = mockEngine(makeRun("failed"));
    const res = await resumePOST(req({ fromPhase: "generate-backend" }), params);
    expect(res.status).toBe(200);
    expect(engine.resumeRun).toHaveBeenCalledWith("run-1", { fromPhase: "generate-backend" });
  });

  it("resumes without an explicit phase", async () => {
    const engine = mockEngine(makeRun("failed"));
    const res = await resumePOST(req(), params);
    expect(res.status).toBe(200);
    expect(engine.resumeRun).toHaveBeenCalledWith("run-1", {});
  });

  it("rejects resume on a non-failed run (409)", async () => {
    const engine = mockEngine(makeRun("awaiting_approval"));
    const res = await resumePOST(req(), params);
    expect(res.status).toBe(409);
    expect(engine.resumeRun).not.toHaveBeenCalled();
  });

  it("404s an unknown run", async () => {
    mockEngine(null);
    const res = await resumePOST(req(), params);
    expect(res.status).toBe(404);
  });
});
