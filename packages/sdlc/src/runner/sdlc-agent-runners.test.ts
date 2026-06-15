import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeLensGate } from "../gates/lens-gate.js";
import { makeInputAdapter } from "../phases/input-adapter.js";
import {
  makeSessionLensRunner,
  makeSessionPlanRunner,
  LENS_SENTINEL,
  PLAN_SENTINEL,
} from "./sdlc-agent-runners.js";
import type { SdlcSessionSpawn } from "./session-runner.js";

/** Fake session manager that writes `output` to `.ao/<sentinel>` on spawn. */
function fakeSpawn(workspaceDir: string, sentinel: string, output: string) {
  const killed: string[] = [];
  const prompts: string[] = [];
  const meta: Record<string, string>[] = [];
  const sm: SdlcSessionSpawn = {
    spawn: async ({ prompt, metadata }) => {
      prompts.push(prompt);
      meta.push(metadata);
      mkdirSync(join(workspaceDir, ".ao"), { recursive: true });
      writeFileSync(join(workspaceDir, ".ao", sentinel), output, "utf-8");
      return { id: "sess-1", workspacePath: workspaceDir };
    },
    kill: async (id) => {
      killed.push(id);
    },
  };
  return { sm, killed, prompts, meta };
}

const VALID_PLAN = `# X Implementation Plan
## Task Graph
\`\`\`yaml
tasks:
  - name: "Repo"
    complexity: LOW
    tdd: true
    depends_on: []
    summary: "s"
\`\`\`
`;

describe("session-backed lens runner", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lens-run-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("yields the right GateVerdict from a sentinel verdict and tags the session", async () => {
    const { sm, killed, prompts, meta } = fakeSpawn(
      dir,
      LENS_SENTINEL,
      '{"verdict":"needs_fixes","issues":[{"severity":"high","title":"t","detail":"d"}]}',
    );
    const gate = makeLensGate("tactical", "Review {artifact}", makeSessionLensRunner(sm, 1_000));
    const v = await gate.evaluate("/tmp/plan.md", "tactical", {
      runId: "run-1",
      phase: "normalize-plan",
    });
    expect(v.verdict).toBe("needs_fixes");
    expect(v.issues[0].severity).toBe("high");
    // session tagged as a lens with the lens-labelled phase, then torn down
    expect(meta[0]).toEqual({ sdlcRunId: "run-1", sdlcPhase: "lens:tactical", sdlcRole: "lens" });
    expect(killed).toEqual(["sess-1"]);
    // prompt carries the artifact path + the sentinel-write instruction
    expect(prompts[0]).toContain("/tmp/plan.md");
    expect(prompts[0]).toContain(`.ao/${LENS_SENTINEL}`);
  });
});

describe("session-backed plan runner", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "plan-run-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns sentinel plan markdown that normalizes, tagging the session as plan", async () => {
    const { sm, killed, meta, prompts } = fakeSpawn(dir, PLAN_SENTINEL, VALID_PLAN);
    const adapt = makeInputAdapter(makeSessionPlanRunner(sm, 1_000));
    const out = await adapt("loose idea", { runId: "run-2", phase: "normalize-plan" });
    expect(out).toContain("## Task Graph");
    expect(meta[0]).toEqual({
      sdlcRunId: "run-2",
      sdlcPhase: "normalize-plan",
      sdlcRole: "plan",
    });
    expect(killed).toEqual(["sess-1"]);
    expect(prompts[0]).toContain(`.ao/${PLAN_SENTINEL}`);
  });
});
