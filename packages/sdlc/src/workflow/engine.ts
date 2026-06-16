import type { RunStore } from "./run-store.js";
import type {
  WorkflowDefinition,
  WorkflowRun,
  PhaseExecutor,
  PhaseContext,
  PrMode,
} from "./types.js";
import type { Gate } from "../gates/types.js";
import type { Epic } from "../plan/types.js";

export interface EngineDeps {
  store: RunStore;
  definitions: Record<string, WorkflowDefinition>;
  executors: Record<string, PhaseExecutor>;
  gates: Record<string, Gate>;
}

export class WorkflowEngine {
  constructor(private readonly deps: EngineDeps) {}

  load(id: string): Promise<WorkflowRun | null> {
    return this.deps.store.load(id);
  }

  async start(
    workflow: string,
    epicId: string,
    input: string,
    opts: { prMode?: PrMode } = {},
  ): Promise<WorkflowRun> {
    const def = this.deps.definitions[workflow];
    if (!def) throw new Error(`Unknown workflow '${workflow}'.`);
    // Unique per start so re-running the same plan never overwrites a prior run.
    const uniqueSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const run: WorkflowRun = {
      id: `run-${epicId}-${uniqueSuffix}`,
      workflow,
      epicId,
      status: "running",
      currentPhaseIndex: 0,
      phaseStates: {},
      taskStatus: {},
      verdicts: [],
      pendingApproval: null,
      createdAt: new Date().toISOString(),
      prMode: opts.prMode ?? "per-task",
    };
    await this.deps.store.save(run);
    return this.advance(run.id, input);
  }

  /** Resume a run paused at a human gate. */
  async resume(id: string): Promise<WorkflowRun> {
    const run = await this.require(id);
    if (run.status !== "awaiting_approval")
      throw new Error(`Run '${id}' is not awaiting approval.`);
    const cleared = await this.deps.store.update(id, (r) => ({
      ...r,
      status: "running",
      pendingApproval: null,
      currentPhaseIndex: r.currentPhaseIndex + 1,
    }));
    return this.advance(cleared.id, "");
  }

  /**
   * Resume a stalled/failed run from a phase (or the phase it stalled in),
   * re-driving `advance`. generate-backend skips already-done tasks, so this
   * picks up the first non-done task rather than restarting the whole run.
   */
  async resumeRun(id: string, opts: { fromPhase?: string } = {}): Promise<WorkflowRun> {
    const run = await this.require(id);
    const def = this.deps.definitions[run.workflow];
    let phaseIndex = run.currentPhaseIndex;
    if (opts.fromPhase) {
      phaseIndex = def.phases.findIndex((p) => p.id === opts.fromPhase);
      if (phaseIndex < 0)
        throw new Error(`Unknown phase '${opts.fromPhase}' for workflow '${run.workflow}'.`);
    }
    const phaseId = def.phases[phaseIndex].id;
    await this.deps.store.update(id, (r) => ({
      ...r,
      status: "running",
      pendingApproval: null,
      lastError: undefined,
      currentPhaseIndex: phaseIndex,
      phaseStates: { ...r.phaseStates, [phaseId]: "pending" },
    }));
    return this.advance(id, "");
  }

  /**
   * Re-spawn a SINGLE task's worker (for `ao sdlc retry`), reusing the persisted
   * epic. Idempotent against already-pushed work (the worker resumes/no-ops and
   * signals via the sentinel). Does not restart the run or touch other tasks.
   */
  async retryTask(id: string, taskId: string): Promise<WorkflowRun> {
    const run = await this.require(id);
    const epic = run.epic ?? null;
    if (!epic) throw new Error(`Run '${id}' has no persisted epic to retry a task from.`);
    const def = this.deps.definitions[run.workflow];
    let executor: PhaseExecutor | undefined;
    let phaseId = "generate-backend";
    for (const phase of def.phases) {
      const ex = this.deps.executors[phase.executor];
      if (ex?.runTask) {
        executor = ex;
        phaseId = phase.id;
        break;
      }
    }
    if (!executor?.runTask)
      throw new Error(`Workflow '${run.workflow}' has no per-task executor to retry.`);
    const ctx = this.makeContext(id, run, epic, "", phaseId);
    await executor.runTask(ctx, taskId);
    return this.require(id);
  }

  /**
   * Mark a run terminal (status `failed`) — reconciles a dead-engine run left as
   * `running` on disk, or lets a human abandon a stuck run.
   */
  async abandon(id: string, message = "Run abandoned."): Promise<WorkflowRun> {
    const run = await this.require(id);
    const phase =
      run.pendingApproval?.phaseId ??
      this.deps.definitions[run.workflow]?.phases[run.currentPhaseIndex]?.id ??
      "abandon";
    return this.deps.store.update(id, (r) => ({
      ...r,
      status: "failed",
      lastError: { phase, message },
    }));
  }

  /** Drives phases from currentPhaseIndex until completion, failure, or a human gate. */
  private async advance(id: string, input: string): Promise<WorkflowRun> {
    let run = await this.require(id);
    const def = this.deps.definitions[run.workflow];
    // Recover the epic persisted by a prior phase (survives pause/resume).
    let epic: Epic | null = run.epic ?? null;

    while (run.currentPhaseIndex < def.phases.length) {
      const phase = def.phases[run.currentPhaseIndex];
      run = await this.deps.store.update(id, (r) => ({
        ...r,
        phaseStates: { ...r.phaseStates, [phase.id]: "running" },
      }));

      const executor = this.deps.executors[phase.executor];
      if (!executor) throw new Error(`No executor registered for '${phase.executor}'.`);

      const ctx = this.makeContext(id, run, epic, input, phase.id);

      let artifactRef: string;
      try {
        const result = await executor.run(ctx);
        if (result.epic) {
          epic = result.epic;
          // Persist so the epic survives a human-gate pause/resume.
          run = await this.deps.store.update(id, (r) => ({ ...r, epic: result.epic }));
        }
        artifactRef = result.artifactRef;
      } catch (e) {
        await this.deps.store.update(id, (r) => ({
          ...r,
          status: "failed",
          phaseStates: { ...r.phaseStates, [phase.id]: "failed" },
        }));
        throw e;
      }

      // run gates (lenses) sequentially; first needs_fixes fails the run.
      // Wrapped like the executor: a gate that throws must not leave the run
      // persisted as "running" — mark it failed, then rethrow.
      try {
        for (const lens of phase.gates) {
          const gate = this.deps.gates[lens];
          if (!gate) throw new Error(`No gate registered for lens '${lens}'.`);
          const verdict = await gate.evaluate(artifactRef, lens, {
            runId: run.id,
            phase: phase.id,
          });
          run = await this.deps.store.update(id, (r) => ({ ...r, verdicts: [...r.verdicts, verdict] }));
          if (verdict.verdict === "needs_fixes") {
            run = await this.deps.store.update(id, (r) => ({
              ...r,
              status: "failed",
              phaseStates: { ...r.phaseStates, [phase.id]: "failed" },
            }));
            return run;
          }
        }
      } catch (e) {
        await this.deps.store.update(id, (r) => ({
          ...r,
          status: "failed",
          phaseStates: { ...r.phaseStates, [phase.id]: "failed" },
        }));
        throw e;
      }

      await this.deps.store.update(id, (r) => ({
        ...r,
        phaseStates: { ...r.phaseStates, [phase.id]: "passed" },
      }));

      if (phase.humanGate) {
        return this.deps.store.update(id, (r) => ({
          ...r,
          status: "awaiting_approval",
          pendingApproval: { phaseId: phase.id, since: new Date().toISOString() },
        }));
      }

      run = await this.deps.store.update(id, (r) => ({
        ...r,
        currentPhaseIndex: r.currentPhaseIndex + 1,
      }));
    }

    return this.deps.store.update(id, (r) => ({ ...r, status: "completed" }));
  }

  /** Build the persisted PhaseContext for a phase/single-task run. */
  private makeContext(
    id: string,
    run: WorkflowRun,
    epic: Epic | null,
    input: string,
    phaseId: string,
  ): PhaseContext {
    return {
      run,
      epic,
      input,
      log: (m) => console.error(`[${run.id}/${phaseId}] ${m}`),
      setTaskStatus: async (taskId, status) => {
        await this.deps.store.update(id, (r) => ({
          ...r,
          taskStatus: { ...r.taskStatus, [taskId]: status },
        }));
      },
      setTaskProgress: async (taskId, progress) => {
        await this.deps.store.update(id, (r) => ({
          ...r,
          taskProgress: {
            ...r.taskProgress,
            [taskId]: { ...progress, updatedAt: new Date().toISOString() },
          },
        }));
      },
    };
  }

  private async require(id: string): Promise<WorkflowRun> {
    const r = await this.deps.store.load(id);
    if (!r) throw new Error(`Run '${id}' not found.`);
    return r;
  }
}
