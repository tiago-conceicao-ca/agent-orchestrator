import { describe, it, expect, vi } from "vitest";
import type { WorkflowEngine } from "@aoagents/ao-sdlc";
import { handleApprove } from "@/lib/sdlc-approve";

describe("handleApprove", () => {
  it("resumes the run when it is awaiting approval", async () => {
    const engine = {
      load: vi.fn().mockResolvedValue({ status: "awaiting_approval" }),
      resume: vi.fn().mockResolvedValue({ status: "running" }),
    };
    const res = await handleApprove(engine as unknown as WorkflowEngine, "run-1");
    expect(engine.resume).toHaveBeenCalledWith("run-1");
    expect(res.ok).toBe(true);
  });

  it("rejects approval when the run is not awaiting", async () => {
    const engine = {
      load: vi.fn().mockResolvedValue({ status: "running" }),
      resume: vi.fn(),
    };
    const res = await handleApprove(engine as unknown as WorkflowEngine, "run-1");
    expect(engine.resume).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it("reports not found when the run is missing", async () => {
    const engine = {
      load: vi.fn().mockResolvedValue(null),
      resume: vi.fn(),
    };
    const res = await handleApprove(engine as unknown as WorkflowEngine, "ghost");
    expect(engine.resume).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not found/i);
  });
});
