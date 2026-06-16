import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type {
  Session,
  SessionManager,
  SiblingRef,
  OrchestratorConfig,
  PluginRegistry,
} from "@contaazul/cahi-core";

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
  get: vi.fn(async (id: string) =>
    id === "backend-3"
      ? ({ id, projectId: "my-app", siblings: testSiblings } as unknown as Session)
      : null,
  ),
} as unknown as SessionManager;

const mockConfig: OrchestratorConfig = {
  configPath: "/tmp/ao-test/cahi.yaml",
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

import * as siblingsRoute from "@/app/api/sessions/[id]/siblings/route";

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(
    new URL(url, "http://localhost:3000"),
    init as ConstructorParameters<typeof NextRequest>[1],
  );
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  (mockSessionManager.get as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) =>
    id === "backend-3"
      ? ({ id, projectId: "my-app", siblings: testSiblings } as unknown as Session)
      : null,
  );
});

describe("GET /api/sessions/[id]/siblings", () => {
  it("returns the session's mounted siblings", async () => {
    const res = await siblingsRoute.GET(
      makeRequest("http://localhost:3000/api/sessions/backend-3/siblings"),
      params("backend-3"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.siblings).toEqual(testSiblings);
  });

  it("returns 404 when the session does not exist", async () => {
    const res = await siblingsRoute.GET(
      makeRequest("http://localhost:3000/api/sessions/ghost/siblings"),
      params("ghost"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid session id", async () => {
    const res = await siblingsRoute.GET(
      makeRequest("http://localhost:3000/api/sessions/bad$id/siblings"),
      params("bad$id"),
    );
    expect(res.status).toBe(400);
  });

  it("does not expose session-level POST/DELETE mutation handlers (#1095)", () => {
    // Siblings are configured per project — mutations go through
    // PATCH /api/projects/[id], not the session.
    expect("POST" in siblingsRoute).toBe(false);
    expect("DELETE" in siblingsRoute).toBe(false);
  });
});
