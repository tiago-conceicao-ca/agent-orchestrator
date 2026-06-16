import type { PhaseExecutor, PhaseContext, PhaseResult, PrMode } from "../workflow/types.js";
import type { Epic, TaskPass, WorkflowTask } from "../plan/types.js";
import { taskDoneSentinelInstruction } from "../runner/task-sentinel.js";
import { passVerdictSentinelInstruction } from "../runner/pass-verdict.js";
import { loadPromptTemplate } from "../gates/lens-gate.js";
import type { GateVerdict, LensIssue } from "../gates/types.js";
import type { TaskOutcome } from "../runner/wait-for-done.js";

export interface SpawnConfig {
  projectId: string;
  prompt: string;
  sdlcTaskId: string;
  metadata: Record<string, string>;
  /** Per-task model alias (`claude --model`); undefined falls back to the project model. */
  model?: string;
  /**
   * SDLC-only: share ONE worktree across a logical task's sequential lens passes.
   * The first pass creates the worktree; later passes attach to it. Undefined =
   * the legacy one-worktree-per-session path (a task without expanded passes).
   */
  worktreeKey?: string;
}
export type SpawnFn = (cfg: SpawnConfig) => Promise<{ id: string; workspacePath?: string }>;
/**
 * Polls AO until the spawned session completes; returns "done" | "failed" |
 * "stalled". `workspacePath` is where the worker's completion sentinel
 * (`.ao/sdlc-task-done.json`) is read from — the primary, PR-independent signal.
 * "stalled" lets the executor auto-retry before failing the run.
 */
export type WaitForDoneFn = (
  sessionId: string,
  workspacePath?: string,
) => Promise<TaskOutcome>;

/** Worker spawns per task/pass before giving up: the initial attempt + one auto-retry. */
export const TASK_MAX_ATTEMPTS = 2;

/** Default dependency-parallel slot cap (logical tasks run concurrently up to this). */
export const DEFAULT_MAX_CONCURRENT = 3;

/**
 * Bounded auto re-dispatches for a pass that returns `needs_fixes`: the initial
 * run + up to (this − 1) fix re-dispatches with the review feedback appended.
 * Exhausting them fails the task. This is OUR deviation from taskmaster (which
 * routes a needs_fixes pass to a human "Needs Clarification" wait) — we keep the
 * loop autonomous and bounded instead.
 */
export const PASS_MAX_FIX_ATTEMPTS = 3;

/**
 * Read a completed pass's lens verdict (from its sentinel) so the scheduler can
 * decide whether to auto re-dispatch. Returns `null` when there is no decisive
 * verdict (treated as a pass). Optional: when undefined, passes complete purely
 * on the worker `done` signal (no verdict gating) — the Task-4 behavior.
 */
export type ReadPassVerdictFn = (
  args: { sessionId: string; workspacePath?: string; task: WorkflowTask; pass: TaskPass },
) => Promise<GateVerdict | null>;

export interface GenerateBackendDeps {
  spawn: SpawnFn; // wraps SessionManager.spawn (Task 16 wires the real one)
  waitForDone: WaitForDoneFn;
  projectId: string;
  /**
   * Build the per-task generation instruction. Defaults to the canonical
   * `/gerar-backend` wording; the smoke injects a generic (e.g. plain Node.js)
   * instruction so it needn't satisfy that skill's workspace prerequisites.
   */
  buildTaskPrompt?: (task: WorkflowTask) => string;
  /**
   * Dependency-parallel slot cap. Dependency-ready logical tasks run
   * concurrently up to this many at a time; completing a task unblocks its
   * dependents. Defaults to {@link DEFAULT_MAX_CONCURRENT}.
   */
  maxConcurrent?: number;
  /**
   * Optional: read a completed pass's verdict so the scheduler can auto
   * re-dispatch a `needs_fixes` pass (bounded). When omitted, passes complete on
   * the worker `done` signal alone (no verdict gating).
   */
  readPassVerdict?: ReadPassVerdictFn;
  /**
   * Optional: after a task's terminal impl pass completes, run the post-impl gate
   * pipeline (risk-review → synthesis → triage → build/test/lint quality gates)
   * over the task's final diff (`artifactRef` = its worktree). `hooks` lets the
   * pipeline record gate verdicts on the run and log progress. A throw fails the
   * task. When omitted, no gate pipeline runs (the Task-4/5 behavior).
   */
  runTaskGates?: (
    task: WorkflowTask,
    artifactRef: string,
    hooks: {
      runId: string;
      recordVerdict?: (verdict: GateVerdict) => Promise<void>;
      log: (msg: string) => void;
    },
  ) => Promise<void>;
}

/** Kahn topological order over the epic's blocking edges (also rejects cycles). */
function topoOrder(epic: Epic): WorkflowTask[] {
  const byId = new Map(epic.tasks.map((t) => [t.id, t]));
  const inDeg = new Map(epic.tasks.map((t) => [t.id, 0]));
  const adj = new Map<string, string[]>(epic.tasks.map((t) => [t.id, []]));
  for (const d of epic.dependencies) {
    // dependsOn -> task
    adj.get(d.dependsOnTaskId)!.push(d.taskId);
    inDeg.set(d.taskId, inDeg.get(d.taskId)! + 1);
  }
  const q = epic.tasks.filter((t) => inDeg.get(t.id) === 0).map((t) => t.id);
  const order: WorkflowTask[] = [];
  while (q.length) {
    const id = q.shift()!;
    order.push(byId.get(id)!);
    for (const m of adj.get(id)!) {
      inDeg.set(m, inDeg.get(m)! - 1);
      if (inDeg.get(m) === 0) q.push(m);
    }
  }
  if (order.length !== epic.tasks.length) throw new Error("Cycle in epic dependencies.");
  return order;
}

/** Canonical /gerar-backend wording used as the default generation instruction. */
export const GERAR_BACKEND_INSTRUCTION = "Run the /gerar-backend skill to implement this task.";

/** Shared epic branch name workers push to in `shared` PR mode. */
export function sharedEpicBranch(epicId: string): string {
  return `sdlc/${epicId}`;
}

/**
 * The per-task completion + sentinel directive, selected by PR mode.
 * - per-task: open your own PR, then write the sentinel (with PR fields).
 * - shared: push to the shared epic branch (no own PR), then write the sentinel.
 */
export function taskCompletionDirective(prMode: PrMode, epicBranch?: string): string {
  if (prMode === "shared") {
    const branch = epicBranch ? ` \`${epicBranch}\`` : "";
    return [
      `When done, push your commits to the shared epic branch${branch}. Do NOT open your ` +
        `own PR — every task in this epic lands in ONE shared PR off that branch.`,
      taskDoneSentinelInstruction({ withPr: false }),
    ].join("\n\n");
  }
  return [`When done, open a PR.`, taskDoneSentinelInstruction({ withPr: true })].join("\n\n");
}

/**
 * Completion directive for a REVIEW pass (correctness/edge_cases/…). The initial
 * pass already opened the PR (or pushed the shared branch); a review pass commits
 * its fixes onto the SAME branch in the shared worktree and signals via the
 * sentinel — it never opens a second PR.
 */
export function reviewPassCompletionDirective(): string {
  return [
    `When done, commit your fixes and push them to the CURRENT branch (the implementation ` +
      `pass already opened the PR / pushed the branch — do NOT open another).`,
    taskDoneSentinelInstruction({ withPr: false }),
  ].join("\n\n");
}

/**
 * Pure render of the per-task agent prompt. This is the single source of truth
 * for what the generate-backend executor dispatches to a spawned session, reused
 * by the dashboard to show a read-only preview of the exact prompt per task.
 * `generationInstruction` defaults to the canonical /gerar-backend wording; the
 * smoke injects a generic instruction so it needn't satisfy that skill's
 * workspace prerequisites.
 */
export function previewTaskPrompt(
  task: WorkflowTask,
  generationInstruction: string = GERAR_BACKEND_INSTRUCTION,
  opts: { prMode?: PrMode; epicBranch?: string } = {},
): string {
  const ac = task.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
  return [
    generationInstruction,
    `Task: ${task.title}`,
    `Summary: ${task.summary}`,
    `Acceptance criteria:\n${ac}`,
    taskCompletionDirective(opts.prMode ?? "per-task", opts.epicBranch),
  ].join("\n\n");
}

/**
 * Render the prompt for one lens pass of a logical task. The `initial` pass uses
 * the task's implementation prompt; each review pass loads its lens template,
 * substitutes the shared worktree path for `{artifact}` (the diff it reviews),
 * and appends the task context + a review-pass completion directive.
 */
export function buildPassPrompt(
  task: WorkflowTask,
  pass: TaskPass,
  sharedWorkspacePath: string | undefined,
  implPromptFor: (task: WorkflowTask) => string,
): string {
  if (pass.role === "initial") return implPromptFor(task);
  const artifact = sharedWorkspacePath ?? "your current worktree";
  const lensBody = loadPromptTemplate(pass.template).replace("{artifact}", artifact);
  const ac = task.acceptanceCriteria.map((c) => `- ${c}`).join("\n");
  return [
    lensBody,
    `Task under review: ${task.title}`,
    `Summary: ${task.summary}`,
    `Acceptance criteria:\n${ac}`,
    reviewPassCompletionDirective(),
    passVerdictSentinelInstruction(),
  ].join("\n\n");
}

/** Resolve the per-task prompt builder from PR mode (+ optional custom override). */
function makePromptFor(deps: GenerateBackendDeps, epic: Epic, prMode: PrMode) {
  const epicBranch = prMode === "shared" ? sharedEpicBranch(epic.id) : undefined;
  return (
    deps.buildTaskPrompt ?? ((task: WorkflowTask) => previewTaskPrompt(task, undefined, { prMode, epicBranch }))
  );
}

/**
 * Spawn one worker (a legacy single-shot task OR one lens pass) and wait for
 * completion, auto-retrying ONCE on a stall. Returns the worker's workspace
 * path; throws on failure or a stall that survives the retry. `worktreeKey`,
 * when set, makes the spawn SHARE a logical task's worktree across its passes.
 * `onAttempt` records per-attempt progress for the caller (task-level kanban).
 */
async function dispatchWithRetry(
  deps: GenerateBackendDeps,
  ctx: PhaseContext,
  args: {
    sdlcTaskId: string;
    title: string;
    prompt: string;
    model?: string;
    worktreeKey?: string;
    label: string;
  },
  onAttempt?: (attempt: number, stalled: boolean) => Promise<void>,
): Promise<{ workspacePath?: string; sessionId: string }> {
  let lastWorkspace: string | undefined;
  let lastSessionId = "";
  for (let attempt = 1; attempt <= TASK_MAX_ATTEMPTS; attempt++) {
    const { id: sessionId, workspacePath } = await deps.spawn({
      projectId: deps.projectId,
      prompt: args.prompt,
      sdlcTaskId: args.sdlcTaskId,
      metadata: { sdlcRunId: ctx.run.id, sdlcTaskId: args.sdlcTaskId, sdlcPhase: "generate-backend" },
      model: args.model,
      worktreeKey: args.worktreeKey,
    });
    lastWorkspace = workspacePath ?? lastWorkspace;
    lastSessionId = sessionId;
    const outcome: TaskOutcome = await deps.waitForDone(sessionId, workspacePath);

    if (outcome === "done") {
      await onAttempt?.(attempt, false);
      return { workspacePath: workspacePath ?? lastWorkspace, sessionId };
    }

    const canRetry = outcome === "stalled" && attempt < TASK_MAX_ATTEMPTS;
    await onAttempt?.(attempt, outcome === "stalled");
    if (canRetry) {
      ctx.log(`${args.label} stalled (attempt ${attempt}); auto-retrying.`);
      continue;
    }
    const why = outcome === "stalled" ? "stalled after auto-retry" : "failed";
    throw new Error(`${args.label} ${why} during backend generation.`);
  }
  // Unreachable: the loop always returns or throws.
  return { workspacePath: lastWorkspace, sessionId: lastSessionId };
}

/** Append the review feedback from a prior `needs_fixes` verdict to a pass prompt. */
function appendPriorIssues(prompt: string, issues: LensIssue[]): string {
  if (issues.length === 0) return prompt;
  const rendered = issues
    .map((i) => `- [${i.severity}] ${i.title}: ${i.detail}`)
    .join("\n");
  return [
    prompt,
    `---`,
    `A previous attempt at THIS pass returned needs_fixes. Address every issue below ` +
      `before reporting pass:`,
    rendered,
  ].join("\n\n");
}

/**
 * Run ONE lens pass to a passing verdict, auto re-dispatching on `needs_fixes`
 * with the review feedback appended — bounded by {@link PASS_MAX_FIX_ATTEMPTS}.
 * Returns the shared worktree path. Throws when the pass still needs fixes after
 * the bound (failing the task) — NOT a human "Needs Clarification" wait. When no
 * `readPassVerdict` is configured, a single successful dispatch passes.
 */
async function runPassWithFixLoop(
  deps: GenerateBackendDeps,
  ctx: PhaseContext,
  task: WorkflowTask,
  pass: TaskPass,
  basePrompt: string,
): Promise<{ workspacePath?: string }> {
  let priorIssues: LensIssue[] = [];
  let workspacePath: string | undefined;
  for (let fixAttempt = 1; fixAttempt <= PASS_MAX_FIX_ATTEMPTS; fixAttempt++) {
    const prompt = appendPriorIssues(basePrompt, priorIssues);
    const dispatched = await dispatchWithRetry(deps, ctx, {
      sdlcTaskId: task.id,
      title: task.title,
      prompt,
      model: pass.model,
      worktreeKey: task.id,
      label: `Task '${task.title}' pass '${pass.role}'${fixAttempt > 1 ? ` (fix ${fixAttempt - 1})` : ""}`,
    });
    workspacePath = dispatched.workspacePath ?? workspacePath;

    if (!deps.readPassVerdict) return { workspacePath }; // no verdict gating (Task-4 path)
    const verdict = await deps.readPassVerdict({
      sessionId: dispatched.sessionId,
      workspacePath,
      task,
      pass,
    });
    // Record every pass verdict (incl. fix attempts) as per-pass history.
    if (verdict) await ctx.recordVerdict?.(verdict);
    if (!verdict || verdict.verdict === "pass") return { workspacePath };

    priorIssues = verdict.issues;
    if (fixAttempt === PASS_MAX_FIX_ATTEMPTS) {
      throw new Error(
        `Task '${task.title}' pass '${pass.role}' still needs fixes after ${PASS_MAX_FIX_ATTEMPTS} attempts.`,
      );
    }
    ctx.log(`Task '${task.title}' pass '${pass.role}' needs fixes; auto re-dispatching with feedback.`);
  }
  // Unreachable: the loop returns or throws.
  return { workspacePath };
}

/**
 * Run one LOGICAL task to completion. A task with expanded `passes` runs its
 * lens passes SEQUENTIALLY, sharing ONE worktree (keyed by the task id) so each
 * review pass reviews the prior pass's diff in place. A task without passes
 * (back-compat / trivial epics) runs the legacy single-shot worker path,
 * untouched (no worktreeKey → one isolated worktree per session). On failure the
 * task is marked blocked and the error propagates to the scheduler.
 */
async function runLogicalTask(
  deps: GenerateBackendDeps,
  ctx: PhaseContext,
  task: WorkflowTask,
  promptFor: (task: WorkflowTask) => string,
): Promise<{ workspacePath?: string }> {
  await ctx.setTaskStatus(task.id, "in_progress");

  // Legacy single-shot path (no expanded passes) — byte-identical to before.
  if (!task.passes || task.passes.length === 0) {
    try {
      const { workspacePath } = await dispatchWithRetry(
        deps,
        ctx,
        { sdlcTaskId: task.id, title: task.title, prompt: promptFor(task), model: task.model, label: `Task '${task.title}'` },
        (attempts, stalled) => ctx.setTaskProgress(task.id, { attempts, stalled }),
      );
      if (deps.runTaskGates && workspacePath)
        await deps.runTaskGates(task, workspacePath, { runId: ctx.run.id, recordVerdict: ctx.recordVerdict, log: ctx.log });
      await ctx.setTaskStatus(task.id, "done");
      return { workspacePath };
    } catch (e) {
      await ctx.setTaskStatus(task.id, "blocked");
      throw e;
    }
  }

  // Graduated lens passes: serialize, sharing the task's worktree. Each pass
  // runs its bounded needs_fixes → auto re-dispatch loop before advancing.
  let sharedWorkspace: string | undefined;
  try {
    for (const pass of task.passes) {
      const prompt = buildPassPrompt(task, pass, sharedWorkspace, promptFor);
      const { workspacePath } = await runPassWithFixLoop(deps, ctx, task, pass, prompt);
      sharedWorkspace = workspacePath ?? sharedWorkspace;
    }
    // After the terminal impl pass: run the post-impl gate pipeline (risk-review
    // → synthesis → triage → quality gates) over the task's final diff.
    if (deps.runTaskGates && sharedWorkspace)
      await deps.runTaskGates(task, sharedWorkspace, { runId: ctx.run.id, recordVerdict: ctx.recordVerdict, log: ctx.log });
    // Record one attempt entry at the task level (passes succeeded).
    await ctx.setTaskProgress(task.id, { attempts: 1, stalled: false });
    await ctx.setTaskStatus(task.id, "done");
    return { workspacePath: sharedWorkspace };
  } catch (e) {
    await ctx.setTaskStatus(task.id, "blocked");
    throw e;
  }
}

/**
 * Dependency-parallel slot scheduler (taskmaster `dispatch_ready_tasks`):
 * dependency-ready logical tasks run concurrently up to a bounded cap; a
 * completing task unblocks its dependents. A failed task isolates its dependents
 * (they never become ready) while independent tasks keep running; the first
 * failure is rethrown once the in-flight work drains. Tasks already `done`
 * (resume) are treated as completed up-front.
 */
async function runScheduler(
  deps: GenerateBackendDeps,
  ctx: PhaseContext,
  epic: Epic,
  promptFor: (task: WorkflowTask) => string,
): Promise<string[]> {
  topoOrder(epic); // reject cycles before scheduling anything

  const tasks = epic.tasks;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indeg = new Map<string, number>(tasks.map((t) => [t.id, 0]));
  const dependents = new Map<string, string[]>(tasks.map((t) => [t.id, []]));
  for (const d of epic.dependencies) {
    if (!byId.has(d.taskId) || !byId.has(d.dependsOnTaskId)) continue;
    indeg.set(d.taskId, (indeg.get(d.taskId) ?? 0) + 1);
    dependents.get(d.dependsOnTaskId)!.push(d.taskId);
  }

  const done = new Set<string>();
  const failed = new Set<string>();
  const scheduled = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();
  const workspacePaths: string[] = [];
  let firstError: Error | undefined;

  const complete = (id: string, workspacePath?: string) => {
    done.add(id);
    if (workspacePath) workspacePaths.push(workspacePath);
    for (const dep of dependents.get(id) ?? []) indeg.set(dep, (indeg.get(dep) ?? 1) - 1);
  };

  // Resume: a task a prior run already finished is complete; unblock dependents.
  for (const t of tasks) {
    if (ctx.run.taskStatus[t.id] === "done") {
      scheduled.add(t.id);
      complete(t.id);
    }
  }

  const cap = Math.max(1, deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);

  const fill = () => {
    for (const t of tasks) {
      if (inFlight.size >= cap) break;
      if (scheduled.has(t.id) || done.has(t.id) || failed.has(t.id)) continue;
      if ((indeg.get(t.id) ?? 0) !== 0) continue; // deps not all done → still blocked
      scheduled.add(t.id);
      const p = runLogicalTask(deps, ctx, t, promptFor)
        .then((r) => complete(t.id, r.workspacePath))
        .catch((err: unknown) => {
          failed.add(t.id);
          if (!firstError) firstError = err instanceof Error ? err : new Error(String(err));
        })
        .finally(() => {
          inFlight.delete(t.id);
        });
      inFlight.set(t.id, p);
    }
  };

  for (;;) {
    fill();
    if (inFlight.size === 0) break;
    await Promise.race([...inFlight.values()]);
  }

  if (firstError) throw firstError;
  return workspacePaths;
}

export function makeGenerateBackendExecutor(deps: GenerateBackendDeps): PhaseExecutor {
  return {
    id: "generate-backend",
    async run(ctx: PhaseContext): Promise<PhaseResult> {
      if (!ctx.epic) throw new Error("generate-backend requires an epic from the prior phase.");
      // PR mode drives the worker's completion expectation: per-task workers open
      // their own PR; shared workers push one epic branch and complete via the
      // sentinel. A custom buildTaskPrompt (e.g. the smoke) overrides verbatim.
      const prMode: PrMode = ctx.run.prMode ?? "per-task";
      const promptFor = makePromptFor(deps, ctx.epic, prMode);
      const workspacePaths = await runScheduler(deps, ctx, ctx.epic, promptFor);
      // Real artifact for the eval gate: the spawned task worktree path(s), one
      // per line. Falls back to an epic ref when no workspace path is available.
      return { artifactRef: workspacePaths.length ? workspacePaths.join("\n") : `epic:${ctx.epic.id}` };
    },
    async runTask(ctx: PhaseContext, taskId: string): Promise<void> {
      if (!ctx.epic) throw new Error("generate-backend runTask requires an epic.");
      const task = ctx.epic.tasks.find((t) => t.id === taskId);
      if (!task) throw new Error(`Task '${taskId}' not found in epic '${ctx.epic.id}'.`);
      const prMode: PrMode = ctx.run.prMode ?? "per-task";
      const promptFor = makePromptFor(deps, ctx.epic, prMode);
      await runLogicalTask(deps, ctx, task, promptFor);
    },
  };
}
