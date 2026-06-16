import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TASK_DONE_SENTINEL,
  readTaskSentinel,
  classifyTaskSentinel,
  taskDoneSentinelInstruction,
} from "./task-sentinel";

function ws(): string {
  return mkdtempSync(join(tmpdir(), "ts-"));
}
function writeSentinel(workspace: string, body: string): void {
  mkdirSync(join(workspace, ".cahi"), { recursive: true });
  writeFileSync(join(workspace, ".cahi", TASK_DONE_SENTINEL), body, "utf-8");
}

describe("readTaskSentinel", () => {
  let dir: string;
  beforeEach(() => {
    dir = ws();
  });

  it("returns null when the workspace path is undefined", () => {
    expect(readTaskSentinel(undefined)).toBeNull();
  });

  it("returns null when the sentinel file is absent", () => {
    expect(readTaskSentinel(dir)).toBeNull();
  });

  it("returns null when the sentinel is empty or unparseable", () => {
    writeSentinel(dir, "   ");
    expect(readTaskSentinel(dir)).toBeNull();
    writeSentinel(dir, "{not json");
    expect(readTaskSentinel(dir)).toBeNull();
  });

  it("returns null when ok is missing or not a boolean", () => {
    writeSentinel(dir, JSON.stringify({ summary: "x" }));
    expect(readTaskSentinel(dir)).toBeNull();
    writeSentinel(dir, JSON.stringify({ ok: "true" }));
    expect(readTaskSentinel(dir)).toBeNull();
  });

  it("parses a success sentinel with optional PR fields", () => {
    writeSentinel(dir, JSON.stringify({ ok: true, prNumber: 7, prUrl: "u", summary: "s" }));
    expect(readTaskSentinel(dir)).toEqual({ ok: true, prNumber: 7, prUrl: "u", summary: "s" });
  });

  it("ignores PR fields of the wrong type", () => {
    writeSentinel(dir, JSON.stringify({ ok: false, prNumber: "7" }));
    expect(readTaskSentinel(dir)).toEqual({ ok: false });
  });
});

describe("classifyTaskSentinel", () => {
  let dir: string;
  beforeEach(() => {
    dir = ws();
  });

  it("maps ok:true → done", () => {
    writeSentinel(dir, JSON.stringify({ ok: true }));
    expect(classifyTaskSentinel(dir)).toBe("done");
  });

  it("maps ok:false → failed", () => {
    writeSentinel(dir, JSON.stringify({ ok: false }));
    expect(classifyTaskSentinel(dir)).toBe("failed");
  });

  it("returns null when absent (keep polling / fall back to PR detection)", () => {
    expect(classifyTaskSentinel(dir)).toBeNull();
  });
});

describe("taskDoneSentinelInstruction", () => {
  it("asks for PR fields in per-task mode", () => {
    const i = taskDoneSentinelInstruction({ withPr: true });
    expect(i).toContain(TASK_DONE_SENTINEL);
    expect(i).toContain("prNumber");
    expect(i).toContain('"ok": false');
  });

  it("omits PR fields in shared mode", () => {
    const i = taskDoneSentinelInstruction({ withPr: false });
    expect(i).not.toContain("prNumber");
    expect(i).toContain('"ok": true');
  });
});
