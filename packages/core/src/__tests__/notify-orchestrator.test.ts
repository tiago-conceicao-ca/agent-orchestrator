import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notifyOrchestrator } from "../notify-orchestrator.js";
import { updateMetadata } from "../metadata.js";

const project = { sessionPrefix: "app" };
const orchestratorId = "app-orchestrator";

describe("notifyOrchestrator", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "notify-orch-"));
  });

  it("sends to the orchestrator when its session metadata exists on disk", async () => {
    updateMetadata(dir, orchestratorId, { role: "orchestrator" });
    const send = vi.fn().mockResolvedValue(undefined);
    await notifyOrchestrator({ send }, project, dir, "hello");
    expect(send).toHaveBeenCalledExactlyOnceWith(orchestratorId, "hello");
  });

  it("no-ops when no orchestrator session metadata exists", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await notifyOrchestrator({ send }, project, dir, "hello");
    expect(send).not.toHaveBeenCalled();
  });

  it("swallows a send error instead of throwing to the caller", async () => {
    updateMetadata(dir, orchestratorId, { role: "orchestrator" });
    const send = vi.fn().mockRejectedValue(new Error("send boom"));
    await expect(notifyOrchestrator({ send }, project, dir, "hello")).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
  });
});
