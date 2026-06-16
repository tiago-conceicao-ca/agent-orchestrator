import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowRun } from "./types.js";

export class RunStore {
  private readonly dir: string;
  /**
   * Serializes `update` calls so concurrent read-modify-write cycles can't lose
   * writes. The dependency-parallel generate-backend scheduler fires many
   * concurrent `setTaskStatus`/`setTaskProgress`/`recordVerdict` updates for one
   * run; without this chain, two in-flight updates that both loaded the same
   * snapshot would clobber each other on save.
   */
  private updateChain: Promise<unknown> = Promise.resolve();
  constructor(baseDir: string) {
    this.dir = join(baseDir, "sdlc", "runs");
  }

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async save(run: WorkflowRun): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = this.path(`.${run.id}.tmp`);
    await writeFile(tmp, JSON.stringify(run, null, 2), "utf-8");
    await rename(tmp, this.path(run.id)); // atomic replace
  }

  async load(id: string): Promise<WorkflowRun | null> {
    try {
      return JSON.parse(await readFile(this.path(id), "utf-8")) as WorkflowRun;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async list(): Promise<WorkflowRun[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }
    const runs: WorkflowRun[] = [];
    for (const f of files)
      if (f.endsWith(".json") && !f.startsWith(".")) {
        const r = await this.load(f.replace(/\.json$/, ""));
        if (r) runs.push(r);
      }
    return runs;
  }

  async update(id: string, patch: (r: WorkflowRun) => WorkflowRun): Promise<WorkflowRun> {
    // Chain behind any in-flight update so the load→patch→save cycle is atomic
    // w.r.t. other updates (the parallel scheduler issues many concurrently).
    const result = this.updateChain.then(async () => {
      const cur = await this.load(id);
      if (!cur) throw new Error(`Run '${id}' not found.`);
      const next = patch(cur);
      await this.save(next);
      return next;
    });
    // Keep the chain alive whether or not this update settled successfully.
    this.updateChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
