/**
 * `ao sdlc` — drive the SDLC workflow orchestrator.
 *
 *   ao sdlc start <planFileOrText>   normalize a plan into an epic, run the
 *                                    ca-plan-to-backend workflow (pauses at the
 *                                    human gate after normalize-plan)
 *   ao sdlc approve <runId>          approve a run paused at a human gate (resume)
 *   ao sdlc status <runId>           print a run's status + per-task kanban state
 *
 * The pure workflow engine lives in @aoagents/ao-sdlc; this command wires AO's
 * real SessionManager into the injected spawn/waitForDone seams and constructs
 * the V1 (ca-plan-to-backend) engine.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import {
  getProjectDir,
  getProjectSessionsDir,
  loadConfig,
  updateMetadata,
  type Session,
} from "@aoagents/ao-core";
import {
  CA_PLAN_TO_BACKEND,
  loadLensPrompt,
  makeGenerateBackendExecutor,
  makeInputAdapter,
  makeLensGate,
  makeNormalizePlanExecutor,
  makePatternLibraryGate,
  RunStore,
  smokeEvalArtifact,
  WorkflowEngine,
  type WorkflowTask,
} from "@aoagents/ao-sdlc";
import { getSessionManager } from "../lib/create-session-manager.js";
import { exec } from "../lib/shell.js";

/** Minimal SessionManager surface the engine wiring needs (real or fake). */
interface SdlcSessionManager {
  spawn(cfg: {
    projectId: string;
    prompt: string;
  }): Promise<{ id: string; workspacePath?: string | null }>;
  get(id: string): Promise<Session | null>;
}

export interface SdlcServiceDeps {
  baseDir: string;
  sessionManager: SdlcSessionManager;
  projectId: string;
  runLensAgent: (prompt: string, artifactRef: string) => Promise<string>;
  runEvalCommand: (artifactRef: string) => Promise<string>;
  runPlanWriteAgent: (input: string) => Promise<string>;
  /** Optional per-task generation instruction (defaults to /gerar-backend wording). */
  buildTaskPrompt?: (task: WorkflowTask) => string;
}

const TASK_POLL_INTERVAL_MS = 5_000;
const TASK_POLL_TIMEOUT_MS = 2 * 60 * 60 * 1_000; // 2h safety cap

/** Map an AO session's terminal state to the engine's done/failed outcome. */
function classifyTerminal(session: Session): "done" | "failed" | null {
  if (session.lifecycle?.pr?.state === "merged") return "done";
  switch (session.status) {
    case "merged":
    case "done":
    case "cleanup":
      return "done";
    case "errored":
    case "killed":
    case "terminated":
      return "failed";
    default:
      return null; // not terminal yet
  }
}

export function buildSdlcServices(deps: SdlcServiceDeps): {
  engine: WorkflowEngine;
  store: RunStore;
} {
  const store = new RunStore(deps.baseDir);
  const dataDir = getProjectSessionsDir(deps.projectId);

  // spawn wrapper: SessionManager.spawn returns a Session; tag SDLC metadata after.
  const spawn = async (cfg: {
    projectId: string;
    prompt: string;
    sdlcTaskId: string;
    metadata: Record<string, string>;
  }): Promise<{ id: string; workspacePath?: string }> => {
    const session = await deps.sessionManager.spawn({ projectId: cfg.projectId, prompt: cfg.prompt });
    updateMetadata(dataDir, session.id, cfg.metadata);
    return { id: session.id, workspacePath: session.workspacePath ?? undefined };
  };

  // waitForDone: poll SessionManager.get(id) until a terminal lifecycle state.
  const waitForDone = async (sessionId: string): Promise<"done" | "failed"> => {
    const deadline = Date.now() + TASK_POLL_TIMEOUT_MS;
    for (;;) {
      const session = await deps.sessionManager.get(sessionId);
      if (session) {
        const outcome = classifyTerminal(session);
        if (outcome) return outcome;
      }
      if (Date.now() > deadline) return "failed";
      await new Promise((resolve) => setTimeout(resolve, TASK_POLL_INTERVAL_MS));
    }
  };

  const executors = {
    "normalize-plan": makeNormalizePlanExecutor({
      adaptToPlan: makeInputAdapter(deps.runPlanWriteAgent),
    }),
    "generate-backend": makeGenerateBackendExecutor({
      spawn,
      waitForDone,
      projectId: deps.projectId,
      buildTaskPrompt: deps.buildTaskPrompt,
    }),
  };

  // Lens templates are the ported plan-review prompt bodies (with the {artifact}
  // placeholder), loaded from the @aoagents/ao-sdlc package's gates/prompts.
  const gates = {
    tactical: makeLensGate("tactical", loadLensPrompt("tactical"), deps.runLensAgent),
    architectural: makeLensGate("architectural", loadLensPrompt("architectural"), deps.runLensAgent),
    "pattern-library": makePatternLibraryGate(deps.runEvalCommand),
  };

  const engine = new WorkflowEngine({
    store,
    definitions: { [CA_PLAN_TO_BACKEND.name]: CA_PLAN_TO_BACKEND },
    executors,
    gates,
  });
  return { engine, store };
}

/** Run `claude` headless (print mode) and return its stdout. */
async function runClaudeHeadless(prompt: string): Promise<string> {
  const { stdout } = await exec("claude", ["-p", prompt]);
  return stdout;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function resolveProjectId(config: ReturnType<typeof loadConfig>, explicit?: string): string {
  if (explicit) {
    if (!config.projects[explicit]) throw new Error(`Unknown project: ${explicit}`);
    return explicit;
  }
  const ids = Object.keys(config.projects);
  if (ids.length === 1) return ids[0];
  throw new Error(
    `Multiple projects configured — pass --project <id> (one of: ${ids.join(", ")}).`,
  );
}

/** Wrap a generic generation instruction into a per-task prompt. */
function genPromptFromInstruction(instruction: string): (task: WorkflowTask) => string {
  return (task) => {
    const ac = task.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
    return [
      instruction,
      `Task: ${task.title}`,
      `Summary: ${task.summary}`,
      `Acceptance criteria:\n${ac}`,
    ].join("\n\n");
  };
}

/** Build the live engine for a project, wiring real agent runners. */
async function buildLiveEngine(
  projectId?: string,
  generationInstruction?: string,
): Promise<{ engine: WorkflowEngine; store: RunStore }> {
  const config = loadConfig();
  const resolvedProjectId = resolveProjectId(config, projectId);
  const sessionManager = await getSessionManager(config);
  return buildSdlcServices({
    baseDir: getProjectDir(resolvedProjectId),
    sessionManager,
    projectId: resolvedProjectId,
    runLensAgent: (prompt) => runClaudeHeadless(prompt),
    runPlanWriteAgent: (input) => runClaudeHeadless(input),
    // Lenient smoke eval: pass only if the generated worktree path(s) contain
    // files. Swap in the real ContaAzul /avaliar-artefato here for a ca-* repo.
    runEvalCommand: (artifactRef) => smokeEvalArtifact(artifactRef),
    buildTaskPrompt: generationInstruction
      ? genPromptFromInstruction(generationInstruction)
      : undefined,
  });
}

function printRun(run: { id: string; status: string; taskStatus: Record<string, string> }): void {
  console.log(chalk.bold(`run ${run.id}`) + chalk.dim(` — ${run.status}`));
  const entries = Object.entries(run.taskStatus);
  if (entries.length === 0) {
    console.log(chalk.dim("  (no tasks yet)"));
    return;
  }
  for (const [taskId, status] of entries) {
    console.log(`  ${chalk.cyan(status.padEnd(12))} ${taskId}`);
  }
}

export function registerSdlc(program: Command): void {
  const sdlc = program.command("sdlc").description("SDLC workflow orchestrator");

  sdlc
    .command("start <planFileOrText>")
    .description("Start an SDLC workflow run from a plan file (or inline plan text)")
    .option("-p, --project <id>", "project id to run backend generation in")
    .option(
      "-g, --generation-instruction <text>",
      "override the per-task generation instruction (default: /gerar-backend). Pass the same value to `approve`.",
    )
    .action(async (planFileOrText: string, opts: { project?: string; generationInstruction?: string }) => {
      try {
        const input = existsSync(planFileOrText)
          ? readFileSync(planFileOrText, "utf-8")
          : planFileOrText;
        const epicId =
          slug(existsSync(planFileOrText) ? basename(planFileOrText).replace(/\.[^.]+$/, "") : "plan") ||
          "plan";
        const { engine } = await buildLiveEngine(opts.project, opts.generationInstruction);
        const run = await engine.start(CA_PLAN_TO_BACKEND.name, epicId, input);
        console.log(chalk.green(`Started SDLC run ${chalk.bold(run.id)} (${run.status}).`));
        printRun(run);
        if (run.status === "awaiting_approval") {
          console.log(chalk.yellow(`\nApprove with: ao sdlc approve ${run.id}`));
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  sdlc
    .command("approve <runId>")
    .description("Approve a run paused at a human gate and resume it")
    .option("-p, --project <id>", "project id the run belongs to")
    .option(
      "-g, --generation-instruction <text>",
      "per-task generation instruction for the resumed generate-backend phase (match the value passed to `start`)",
    )
    .action(async (runId: string, opts: { project?: string; generationInstruction?: string }) => {
      try {
        const { engine } = await buildLiveEngine(opts.project, opts.generationInstruction);
        const current = await engine.load(runId);
        if (!current) throw new Error(`Run not found: ${runId}`);
        if (current.status !== "awaiting_approval")
          throw new Error(`Run '${runId}' is '${current.status}', not awaiting approval.`);
        const run = await engine.resume(runId);
        console.log(chalk.green(`Approved run ${chalk.bold(runId)}.`));
        printRun(run);
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  sdlc
    .command("status <runId>")
    .description("Print a run's status and per-task kanban state")
    .option("-p, --project <id>", "project id the run belongs to")
    .action(async (runId: string, opts: { project?: string }) => {
      try {
        const { store } = await buildLiveEngine(opts.project);
        const run = await store.load(runId);
        if (!run) throw new Error(`Run not found: ${runId}`);
        printRun(run);
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}
