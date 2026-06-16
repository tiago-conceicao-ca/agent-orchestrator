import { describe, it, expect } from "vitest";
import { waitForTaskCompletion } from "./wait-for-done";

/** A controllable clock + no-op sleep that advances the clock by the slept ms. */
function fakeClock(startMs = 0) {
  let t = startMs;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const base = {
  sessionId: "s1",
  workspacePath: "/ws",
  timeoutMs: 1000,
  pollIntervalMs: 10,
};

describe("waitForTaskCompletion", () => {
  it("returns done immediately when the sentinel says ok:true (before any PR signal)", async () => {
    let classifyCalls = 0;
    const out = await waitForTaskCompletion({
      ...base,
      classifySession: async () => {
        classifyCalls++;
        return null;
      },
      readSentinel: () => "done",
    });
    expect(out).toBe("done");
    expect(classifyCalls).toBe(0); // sentinel checked first, PR fallback never consulted
  });

  it("returns failed when the sentinel says ok:false", async () => {
    const out = await waitForTaskCompletion({
      ...base,
      classifySession: async () => null,
      readSentinel: () => "failed",
    });
    expect(out).toBe("failed");
  });

  it("falls back to PR/lifecycle classification when no sentinel is present", async () => {
    const out = await waitForTaskCompletion({
      ...base,
      classifySession: async () => "done",
      readSentinel: () => null,
    });
    expect(out).toBe("done");
  });

  it("keeps polling until the sentinel appears", async () => {
    const clock = fakeClock();
    let polls = 0;
    const out = await waitForTaskCompletion({
      ...base,
      now: clock.now,
      sleep: clock.sleep,
      classifySession: async () => null,
      readSentinel: () => (++polls >= 3 ? "done" : null),
    });
    expect(out).toBe("done");
    expect(polls).toBe(3);
  });

  it("returns failed when the hard timeout is reached with no signal", async () => {
    const clock = fakeClock();
    const out = await waitForTaskCompletion({
      ...base,
      timeoutMs: 50,
      pollIntervalMs: 20,
      now: clock.now,
      sleep: clock.sleep,
      classifySession: async () => null,
      readSentinel: () => null,
    });
    expect(out).toBe("failed");
  });

  it("returns stalled when the stall threshold is crossed before the hard cap", async () => {
    const clock = fakeClock();
    const out = await waitForTaskCompletion({
      ...base,
      timeoutMs: 10_000,
      stallThresholdMs: 50,
      pollIntervalMs: 20,
      now: clock.now,
      sleep: clock.sleep,
      classifySession: async () => null,
      readSentinel: () => null,
    });
    expect(out).toBe("stalled");
  });
});
