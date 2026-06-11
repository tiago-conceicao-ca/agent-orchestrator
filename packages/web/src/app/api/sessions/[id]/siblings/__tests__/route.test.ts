import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  SessionNotFoundError,
  type Session,
  type SessionManager,
  type SiblingRef,
  type OrchestratorConfig,
  type PluginRegistry,
} from "@aoagents/ao-core";

function makeSibling(overrides: Partial<SiblingRef> = {}): SiblingRef {
  return {
    repo: "ds-front",
    path: "/wt/backend-3__sib__ds-front",
    branch: "sib/backend-3/ds-front",
    mode: "worktree",
    ...overrides,
  };
}

const testSiblings: SiblingRef[] = [makeSibling()];

const mockSessionManager = {
  addSibling: vi.fn(async (_id: string, repo: string) => makeSibling({ repo })),
  removeSibling: vi.fn(async () => {}),
  get: vi.fn(async (id: string) =>
    id === "backend-3"
      ? ({ id, projectId: "my-app", siblings: testSiblings } as unknown as Session)
      : null,
  ),
} as unknown as SessionManager;

const mockConfig: OrchestratorConfig = {
  configPath: "/tmp/ao-test/agent-orchestrator.yaml",
  port: 3000,
  readyThresholdMs: 300_000,
  defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
  projects: {
    "my-app": {
      name: "My App",
      repo: "acme/my-app",
      path: "/tmp/my-app",
      defaultBranch: "main",
      sessionPrefix: "my-app",
      scm: { plugin: "github" },
    },
  },
  notifiers: {},
  notificationRouting: { urgent: [], action: [], warning: [], info: [] },
  reactions: {},
};

const mockRegistry = {
  register: vi.fn(),
  get: vi.fn(),
  list: vi.fn(() => []),
} as unknown as PluginRegistry;

vi.mock("@/lib/services", () => ({
  getServices: vi.fn(async () => ({
    config: mockConfig,
    registry: mockRegistry,
    sessionManager: mockSessionManager,
  })),
}));

import {
  GET as siblingsGET,
  POST as siblingsPOST,
  DELETE as siblingsDELETE,
} from "@/app/api/sessions/[id]/siblings/route";

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(
    new URL(url, "http://localhost:3000"),
    init as ConstructorParameters<typeof NextRequest>[1],
  );
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  (mockSessionManager.addSibling as ReturnType<typeof vi.fn>).mockImplementation(
    async (_id: string, repo: string) => makeSibling({ repo }),
  );
  (mockSessionManager.removeSibling as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (mockSessionManager.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) =>
    id === "backend-3"
      ? ({ id, projectId: "my-app", siblings: testSiblings } as unknown as Session)
      : null,
  );
});

describe("GET /api/sessions/[id]/siblings", () => {
  it("returns the session's mounted siblings", async () => {
    const res = await siblingsGET(
      makeRequest("http://localhost:3000/api/sessions/backend-3/siblings"),
      params("backend-3"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.siblings).toEqual(testSiblings);
  });

  it("returns 404 when the session does not exist", async () => {
    const res = await siblingsGET(
      makeRequest("http://localhost:3000/api/sessions/ghost/siblings"),
      params("ghost"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid session id", async () => {
    const res = await siblingsGET(
      makeRequest("http://localhost:3000/api/sessions/bad$id/siblings"),
      params("bad$id"),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/sessions/[id]/siblings", () => {
  function postRequest(id: string, body: unknown): NextRequest {
    return makeRequest(`http://localhost:3000/api/sessions/${id}/siblings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("mounts a sibling and returns 201 with the ref", async () => {
    const res = await siblingsPOST(postRequest("backend-3", { repo: "ds-front" }), params("backend-3"));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sibling.repo).toBe("ds-front");
    expect(mockSessionManager.addSibling).toHaveBeenCalledWith("backend-3", "ds-front", {
      branch: undefined,
      mode: undefined,
    });
  });

  it("passes branch and mode through to the core", async () => {
    await siblingsPOST(
      postRequest("backend-3", { repo: "ds-front", branch: "release/2.0", mode: "readonly-symlink" }),
      params("backend-3"),
    );
    expect(mockSessionManager.addSibling).toHaveBeenCalledWith("backend-3", "ds-front", {
      branch: "release/2.0",
      mode: "readonly-symlink",
    });
  });

  it("returns 400 when repo is missing", async () => {
    const res = await siblingsPOST(postRequest("backend-3", {}), params("backend-3"));
    expect(res.status).toBe(400);
    expect(mockSessionManager.addSibling).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid mode", async () => {
    const res = await siblingsPOST(
      postRequest("backend-3", { repo: "ds-front", mode: "bogus" }),
      params("backend-3"),
    );
    expect(res.status).toBe(400);
    expect(mockSessionManager.addSibling).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const req = makeRequest("http://localhost:3000/api/sessions/backend-3/siblings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const res = await siblingsPOST(req, params("backend-3"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when the session is unknown", async () => {
    (mockSessionManager.addSibling as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new SessionNotFoundError("ghost"),
    );
    const res = await siblingsPOST(postRequest("ghost", { repo: "ds-front" }), params("ghost"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the repo is not in the catalog", async () => {
    (mockSessionManager.addSibling as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Unknown sibling repo "nope": no registered project matches that id or repo'),
    );
    const res = await siblingsPOST(postRequest("backend-3", { repo: "nope" }), params("backend-3"));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Unknown sibling repo");
  });

  it("returns 409 when the sibling is already mounted", async () => {
    (mockSessionManager.addSibling as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Sibling "ds-front" is already mounted on session backend-3'),
    );
    const res = await siblingsPOST(postRequest("backend-3", { repo: "ds-front" }), params("backend-3"));
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/sessions/[id]/siblings", () => {
  it("unmounts a sibling via ?repo= and returns 200", async () => {
    const res = await siblingsDELETE(
      makeRequest("http://localhost:3000/api/sessions/backend-3/siblings?repo=ds-front", {
        method: "DELETE",
      }),
      params("backend-3"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(mockSessionManager.removeSibling).toHaveBeenCalledWith("backend-3", "ds-front");
  });

  it("returns 400 when the repo query param is missing", async () => {
    const res = await siblingsDELETE(
      makeRequest("http://localhost:3000/api/sessions/backend-3/siblings", { method: "DELETE" }),
      params("backend-3"),
    );
    expect(res.status).toBe(400);
    expect(mockSessionManager.removeSibling).not.toHaveBeenCalled();
  });

  it("returns 404 when the sibling is not mounted", async () => {
    (mockSessionManager.removeSibling as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Sibling "ds-front" is not mounted on session backend-3'),
    );
    const res = await siblingsDELETE(
      makeRequest("http://localhost:3000/api/sessions/backend-3/siblings?repo=ds-front", {
        method: "DELETE",
      }),
      params("backend-3"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the session is unknown", async () => {
    (mockSessionManager.removeSibling as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new SessionNotFoundError("ghost"),
    );
    const res = await siblingsDELETE(
      makeRequest("http://localhost:3000/api/sessions/ghost/siblings?repo=ds-front", {
        method: "DELETE",
      }),
      params("ghost"),
    );
    expect(res.status).toBe(404);
  });
});
