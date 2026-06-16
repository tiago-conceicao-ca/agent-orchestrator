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
  makeSdlcRunEventHandler,
  makeSessionLensRunner,
  makeSessionPlanRunner,
  readPassVerdictSentinel,
  RunStore,
  smokeEvalArtifact,
  waitForTaskCompletion,
  WorkflowEngine,
  type RunContext,
  type SdlcRunEvent,
  type SdlcSessionSpawn,
  type WorkflowTask,
} from "@aoagents/ao-sdlc";
import { getPluginRegistry, getSessionManager } from "../lib/create-session-manager.js";

/** Minimal SessionManager surface the engine wiring needs (real or fake). */
interface SdlcSessionManager {
  spawn(cfg: {
    projectId: string;
    prompt: string;
    model?: string;
    worktreeKey?: string;
  }): Promise<{ id: string; workspacePath?: string | null }>;
  get(id: string): Promise<Session | null>;
  kill(id: string): Promise<unknown>;
}

export interface SdlcServiceDeps {
  baseDir: string;
  sessionManager: SdlcSessionManager;
  projectId: string;
  runLensAgent: (prompt: string, artifactRef: string, ctx: RunContext) => Promise<string>;
  runEvalCommand: (artifactRef: string) => Promise<string>;
  runPlanWriteAgent: (input: string, ctx: RunContext) => Promise<string>;
  /** Optional per-task generation instruction (defaults to /gerar-backend wording). */
  buildTaskPrompt?: (task: WorkflowTask) => string;
  /** Optional run-event sink (orchestrator notify + activity + notifiers). */
  onRunEvent?: (event: SdlcRunEvent) => Promise<void>;
}

const TASK_POLL_INTERVAL_MS = 5_000;
const TASK_POLL_TIMEOUT_MS = 2 * 60 * 60 * 1_000; // 2h safety cap
// A task with no completion signal past this threshold is "stalled" → one
// auto-retry (configurable via AO_SDLC_STALL_THRESHOLD_MS).
const TASK_STALL_THRESHOLD_MS =
  Number(process.env.AO_SDLC_STALL_THRESHOLD_MS) || 20 * 60 * 1_000;

/**
 * Map an AO session's terminal state to the engine's done/failed outcome.
 *
 * A successful agent that has OPENED a PR (CI green/pending) is "done" — a merge
 * is NOT required. Only a still-working session with no PR yet keeps polling.
 */
export function classifyTerminal(session: Session): "done" | "failed" | null {
  const prState = session.lifecycle?.pr?.state;
  const prExists = prState === "open" || prState === "merged";
  const ciFailing =
    session.status === "ci_failed" || session.lifecycle?.pr?.reason === "ci_failing";

  // Hard failure: the process died, or a PR exists but its CI is failing.
  if (
    session.status === "errored" ||
    session.status === "killed" ||
    session.status === "terminated" ||
    ciFailing
  ) {
    return "failed";
  }

  // Success: a PR exists (open or merged, CI green/pending), or the legacy
  // status already advanced past PR creation. A merge is NOT required.
  if (prExists) return "done";
  switch (session.status) {
    case "pr_open":
    case "review_pending":
    case "mergeable":
    case "merged":
    case "done":
    case "cleanup":
      return "done";
    default:
      return null; // still working with no PR yet — keep polling
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
    model?: string;
    worktreeKey?: string;
  }): Promise<{ id: string; workspacePath?: string }> => {
    const session = await deps.sessionManager.spawn({
      projectId: cfg.projectId,
      prompt: cfg.prompt,
      model: cfg.model,
      worktreeKey: cfg.worktreeKey,
    });
    updateMetadata(dataDir, session.id, cfg.metadata);
    return { id: session.id, workspacePath: session.workspacePath ?? undefined };
  };

  // waitForDone: the worker's `.ao/sdlc-task-done.json` sentinel is the primary,
  // PR-independent completion signal; classifyTerminal (PR/lifecycle) remains the
  // fallback when no sentinel is written. 2h hard cap retained.
  const waitForDone = (sessionId: string, workspacePath?: string) =>
    waitForTaskCompletion({
      sessionId,
      workspacePath,
      classifySession: async (id) => {
        const session = await deps.sessionManager.get(id);
        return session ? classifyTerminal(session) : null;
      },
      timeoutMs: TASK_POLL_TIMEOUT_MS,
      stallThresholdMs: TASK_STALL_THRESHOLD_MS,
      pollIntervalMs: TASK_POLL_INTERVAL_MS,
    });

  const executors = {
    "normalize-plan": makeNormalizePlanExecutor({
      adaptToPlan: makeInputAdapter(deps.runPlanWriteAgent),
    }),
    "generate-backend": makeGenerateBackendExecutor({
      spawn,
      waitForDone,
      projectId: deps.projectId,
      buildTaskPrompt: deps.buildTaskPrompt,
      maxConcurrent: Number(process.env.AO_SDLC_MAX_CONCURRENT) || 3,
      // Auto re-dispatch a pass whose verdict sentinel says needs_fixes (bounded).
      readPassVerdict: async ({ workspacePath, task, pass }) =>
        readPassVerdictSentinel(workspacePath, `impl:${task.id}:${pass.role}`),
    }),
  };

  // Lens templates are the ported plan-review prompt bodies (with the {artifact}
  // placeholder), loaded from the @aoagents/ao-sdlc package's gates/prompts.
  const gates = {
    tactical: makeLensGate("tactical", loadLensPrompt("tactical"), deps.runLensAgent),
    architectural: makeLensGate(
      "architectural",
      loadLensPrompt("architectural"),
      deps.runLensAgent,
    ),
    "pattern-library": makePatternLibraryGate(deps.runEvalCommand),
  };

  const engine = new WorkflowEngine({
    store,
    definitions: { [CA_PLAN_TO_BACKEND.name]: CA_PLAN_TO_BACKEND },
    executors,
    gates,
    onRunEvent: deps.onRunEvent,
  });
  return { engine, store };
}

/**
 * Adapt the real SessionManager into the {@link SdlcSessionSpawn} the
 * session-backed runner needs: spawn tags SDLC metadata, kill tears the session
 * down once its sentinel output has been read.
 */
function makeSdlcSessionSpawn(
  sessionManager: SdlcSessionManager,
  projectId: string,
): SdlcSessionSpawn {
  const dataDir = getProjectSessionsDir(projectId);
  return {
    spawn: async ({ prompt, metadata }) => {
      const session = await sessionManager.spawn({ projectId, prompt });
      updateMetadata(dataDir, session.id, metadata);
      return { id: session.id, workspacePath: session.workspacePath ?? undefined };
    },
    kill: async (id) => {
      await sessionManager.kill(id);
    },
  };
}

/** Validate a --pr-mode flag value. */
function parsePrMode(value: string | undefined): "per-task" | "shared" | undefined {
  if (value === undefined) return undefined;
  if (value !== "per-task" && value !== "shared") {
    throw new Error(`Invalid --pr-mode '${value}' (expected 'per-task' or 'shared').`);
  }
  return value;
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
  skipLens = false,
): Promise<{ engine: WorkflowEngine; store: RunStore }> {
  const config = loadConfig();
  const resolvedProjectId = resolveProjectId(config, projectId);
  const sessionManager = await getSessionManager(config);
  const registry = await getPluginRegistry(config);
  const sessionSpawn = makeSdlcSessionSpawn(sessionManager, resolvedProjectId);
  // Notify the orchestrator (+ activity feed + human notifiers) on RUN-level
  // events, mirroring how a worker session's transitions reach the orchestrator.
  const onRunEvent = makeSdlcRunEventHandler({
    sessionManager,
    config,
    registry,
    projectId: resolvedProjectId,
    project: config.projects[resolvedProjectId],
    sessionsDir: getProjectSessionsDir(resolvedProjectId),
  });
  return buildSdlcServices({
    baseDir: getProjectDir(resolvedProjectId),
    sessionManager,
    projectId: resolvedProjectId,
    onRunEvent,
    // Run each lens as a real, interactive AO worker session (visible/attachable
    // on the board) instead of a headless `claude -p`. The session writes its
    // verdict JSON to a sentinel file the runner reads on completion.
    // When --skip-lens is set, the lens runner returns a trivially-passing
    // plan_review WITHOUT spawning a session — for demo/testing a minimal plan
    // that the tactical/architectural lens would otherwise reject by design.
    runLensAgent: skipLens
      ? async () =>
          JSON.stringify({ type: "plan_review", lens: "tactical", issues: [], verdict: "pass" })
      : makeSessionLensRunner(sessionSpawn),
    // Draft the tm-style plan in a real worker session too; the agent writes the
    // plan markdown to a sentinel file the runner reads. The normalize-plan
    // hasTaskGraph short-circuit means no session is spawned when the input is
    // already a structured plan.
    runPlanWriteAgent: makeSessionPlanRunner(sessionSpawn),
    // Lenient smoke eval: pass only if the generated worktree path(s) contain
    // files. Swap in the real ContaAzul /avaliar-artefato here for a ca-* repo.
    runEvalCommand: (artifactRef) => smokeEvalArtifact(artifactRef),
    buildTaskPrompt: generationInstruction
      ? genPromptFromInstruction(generationInstruction)
      : undefined,
  });
}

interface PrintableRun {
  id: string;
  status: string;
  taskStatus: Record<string, string>;
  prMode?: string;
  taskProgress?: Record<string, { attempts: number; stalled: boolean }>;
}

export function printRun(run: PrintableRun): void {
  const mode = run.prMode ? chalk.dim(` [${run.prMode}]`) : "";
  console.log(chalk.bold(`run ${run.id}`) + chalk.dim(` — ${run.status}`) + mode);
  const entries = Object.entries(run.taskStatus);
  if (entries.length === 0) {
    console.log(chalk.dim("  (no tasks yet)"));
    return;
  }
  for (const [taskId, status] of entries) {
    const p = run.taskProgress?.[taskId];
    // Surface stalls and auto-retries so a stuck task is visible, not silent.
    const notes: string[] = [];
    if (p?.stalled) notes.push(chalk.yellow("stalled"));
    if (p && p.attempts > 1) notes.push(chalk.magenta(`retried x${p.attempts - 1}`));
    const suffix = notes.length ? chalk.dim(`  (${notes.join(", ")})`) : "";
    console.log(`  ${chalk.cyan(status.padEnd(12))} ${taskId}${suffix}`);
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
    .option(
      "--skip-lens",
      "Bypass lens gates (tactical/architectural) for this run — demo/testing only",
    )
    .option(
      "--pr-mode <mode>",
      "PR landing mode: 'per-task' (each worker opens its own PR, default) or 'shared' (N tasks land in one PR via the sentinel)",
    )
    .action(
      async (
        planFileOrText: string,
        opts: {
          project?: string;
          generationInstruction?: string;
          skipLens?: boolean;
          prMode?: string;
        },
      ) => {
        try {
          const prMode = parsePrMode(opts.prMode);
          const input = existsSync(planFileOrText)
            ? readFileSync(planFileOrText, "utf-8")
            : planFileOrText;
          const epicId =
            slug(
              existsSync(planFileOrText)
                ? basename(planFileOrText).replace(/\.[^.]+$/, "")
                : "plan",
            ) || "plan";
          const { engine } = await buildLiveEngine(
            opts.project,
            opts.generationInstruction,
            opts.skipLens,
          );
          const run = await engine.start(CA_PLAN_TO_BACKEND.name, epicId, input, { prMode });
          console.log(chalk.green(`Started SDLC run ${chalk.bold(run.id)} (${run.status}).`));
          printRun(run);
          if (run.status === "awaiting_approval") {
            console.log(chalk.yellow(`\nApprove with: ao sdlc approve ${run.id}`));
          }
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        }
      },
    );

  sdlc
    .command("approve <runId>")
    .description("Approve a run paused at a human gate and resume it")
    .option("-p, --project <id>", "project id the run belongs to")
    .option(
      "-g, --generation-instruction <text>",
      "per-task generation instruction for the resumed generate-backend phase (match the value passed to `start`)",
    )
    .option(
      "--skip-lens",
      "Bypass lens gates (tactical/architectural) for this run — demo/testing only",
    )
    .option(
      "--pr-mode <mode>",
      "override the run's PR landing mode ('per-task' | 'shared') before resuming the generate-backend phase",
    )
    .action(
      async (
        runId: string,
        opts: {
          project?: string;
          generationInstruction?: string;
          skipLens?: boolean;
          prMode?: string;
        },
      ) => {
        try {
          const prMode = parsePrMode(opts.prMode);
          const { engine, store } = await buildLiveEngine(
            opts.project,
            opts.generationInstruction,
            opts.skipLens,
          );
          const current = await engine.load(runId);
          if (!current) throw new Error(`Run not found: ${runId}`);
          if (current.status !== "awaiting_approval")
            throw new Error(`Run '${runId}' is '${current.status}', not awaiting approval.`);
          // The generate-backend executor reads prMode from the persisted record;
          // a flag here overrides what `start` set.
          if (prMode) await store.update(runId, (r) => ({ ...r, prMode }));
          const run = await engine.resume(runId);
          console.log(chalk.green(`Approved run ${chalk.bold(runId)}.`));
          printRun(run);
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        }
      },
    );

  sdlc
    .command("status <runId>")
    .description("Print a run's status and per-task kanban state")
    .option("-p, --project <id>", "project id the run belongs to")
    .action(async (runId: string, opts: { project?: string }) => {
      try {
        const { engine, store } = await buildLiveEngine(opts.project);
        if (!(await store.load(runId))) throw new Error(`Run not found: ${runId}`);
        // Reconcile a run whose driving engine process has died (stale running).
        const run = await engine.reconcile(runId);
        printRun(run);
        if (run.lastError) {
          console.log(
            chalk.red(`  error [${run.lastError.phase}]: ${run.lastError.message}`),
          );
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });

  sdlc
    .command("retry <runId>")
    .description("Re-spawn a single task's worker, reusing the persisted epic")
    .requiredOption("--task <taskId>", "id of the task to re-run")
    .option("-p, --project <id>", "project id the run belongs to")
    .option("-g, --generation-instruction <text>", "per-task generation instruction (match `start`)")
    .option("--skip-lens", "Bypass lens gates (no effect on a single-task retry)")
    .action(
      async (
        runId: string,
        opts: { task: string; project?: string; generationInstruction?: string; skipLens?: boolean },
      ) => {
        try {
          const { engine } = await buildLiveEngine(
            opts.project,
            opts.generationInstruction,
            opts.skipLens,
          );
          const run = await engine.retryTask(runId, opts.task);
          console.log(chalk.green(`Retried task ${chalk.bold(opts.task)} on run ${runId}.`));
          printRun(run);
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        }
      },
    );

  sdlc
    .command("resume <runId>")
    .description("Resume a stalled/failed run from a phase or the first non-done task")
    .option("-p, --project <id>", "project id the run belongs to")
    .option("--from-phase <phase>", "phase id to resume from (default: the phase it stopped in)")
    .option("-g, --generation-instruction <text>", "per-task generation instruction (match `start`)")
    .option("--skip-lens", "Bypass lens gates (tactical/architectural) for this run")
    .action(
      async (
        runId: string,
        opts: {
          project?: string;
          fromPhase?: string;
          generationInstruction?: string;
          skipLens?: boolean;
        },
      ) => {
        try {
          const { engine } = await buildLiveEngine(
            opts.project,
            opts.generationInstruction,
            opts.skipLens,
          );
          const run = await engine.resumeRun(runId, { fromPhase: opts.fromPhase });
          console.log(chalk.green(`Resumed run ${chalk.bold(runId)} (${run.status}).`));
          printRun(run);
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        }
      },
    );

  sdlc
    .command("abandon <runId>")
    .description("Mark a run terminal (reconciles a stale status:running from a dead engine)")
    .option("-p, --project <id>", "project id the run belongs to")
    .action(async (runId: string, opts: { project?: string }) => {
      try {
        const { engine } = await buildLiveEngine(opts.project);
        const run = await engine.abandon(runId);
        console.log(chalk.yellow(`Abandoned run ${chalk.bold(runId)} (${run.status}).`));
        printRun(run);
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}
