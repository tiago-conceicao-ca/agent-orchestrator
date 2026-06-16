import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateMetadata, type OrchestratorEvent, type PluginRegistry } from "@contaazul/cahi-core";
import { makeSdlcRunEventHandler, type SdlcRunEventNotifierDeps } from "./run-event-notifier.js";
import type { SdlcRunEvent } from "../workflow/types.js";

const project = { sessionPrefix: "app" };
const orchestratorId = "app-orchestrator";

function makeDeps(dir: string, overrides: Partial<SdlcRunEventNotifierDeps> = {}) {
  const send = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn().mockResolvedValue(undefined);
  const registry = {
    get: vi.fn(() => ({ name: "desktop", notify })),
  } as unknown as PluginRegistry;
  const config = {
    notificationRouting: { action: ["desktop"], warning: ["desktop"], info: ["desktop"], urgent: ["desktop"] },
    defaults: { notifiers: ["desktop"] },
  } as unknown as SdlcRunEventNotifierDeps["config"];
  const deps: SdlcRunEventNotifierDeps = {
    sessionManager: { send },
    config,
    registry,
    projectId: "proj",
    project,
    sessionsDir: dir,
    ...overrides,
  };
  return { deps, send, notify, registry };
}

describe("makeSdlcRunEventHandler", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sdlc-runevent-"));
  });

  it("notifies the orchestrator and routes to a notifier when an orchestrator exists", async () => {
    updateMetadata(dir, orchestratorId, { role: "orchestrator" });
    const { deps, send, notify } = makeDeps(dir);
    const handler = makeSdlcRunEventHandler(deps);
    const event: SdlcRunEvent = {
      kind: "awaiting_approval",
      runId: "run-1",
      phase: "normalize-plan",
      detail: "passed gates",
    };
    await handler(event);

    expect(send).toHaveBeenCalledOnce();
    const [sentTo, sentMsg] = send.mock.calls[0];
    expect(sentTo).toBe(orchestratorId);
    expect(sentMsg).toContain("[sdlc run-1] awaiting_approval");
    expect(sentMsg).toContain("/sdlc/run-1");

    expect(notify).toHaveBeenCalledOnce();
    const routed = notify.mock.calls[0][0] as OrchestratorEvent;
    expect(routed.type).toBe("sdlc.awaiting_approval");
    expect(routed.priority).toBe("action");
  });

  it("does not notify the orchestrator when no orchestrator session exists (but still routes notifiers)", async () => {
    const { deps, send, notify } = makeDeps(dir);
    const handler = makeSdlcRunEventHandler(deps);
    await handler({ kind: "completed", runId: "run-2" });
    expect(send).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    expect((notify.mock.calls[0][0] as OrchestratorEvent).priority).toBe("info");
  });

  it.each([
    ["awaiting_approval", "action"],
    ["needs_fixes", "action"],
    ["completed", "info"],
    ["failed", "warning"],
    ["stalled", "warning"],
  ] as const)("maps %s to priority %s", async (kind, priority) => {
    const { deps, notify } = makeDeps(dir);
    const handler = makeSdlcRunEventHandler(deps);
    await handler({ kind, runId: "run-x" });
    expect((notify.mock.calls.at(-1)?.[0] as OrchestratorEvent).priority).toBe(priority);
  });

  it("does not throw when a notifier throws", async () => {
    updateMetadata(dir, orchestratorId, { role: "orchestrator" });
    const notify = vi.fn().mockRejectedValue(new Error("notifier boom"));
    const registry = { get: vi.fn(() => ({ name: "x", notify })) } as unknown as PluginRegistry;
    const { deps, send } = makeDeps(dir, { registry });
    const handler = makeSdlcRunEventHandler(deps);
    await expect(handler({ kind: "failed", runId: "run-3" })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce(); // orchestrator notify still happened
  });
});
