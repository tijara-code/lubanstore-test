/**
 * Scheduled jobs. Each is a function of the dependencies; Netlify's scheduled functions
 * (netlify/functions/job-*.mts) and the admin's "run now" buttons call them through runJob.
 * Every run is recorded in ops (`job:<name>`) so /api/health can say when a job is stale.
 */
import { errorStack, errorText } from "../core/log";
import type { Deps } from "../core/deps";
import { putOp } from "../core/ops";

export type JobFn = (deps: Deps) => Promise<Record<string, unknown>>;

/** name → { every (minutes, for staleness), run } — filled in by each area's module. */
export const JOBS: Record<string, { everyMin: number; run: JobFn }> = {};

export function defineJob(name: string, everyMin: number, run: JobFn): void {
  JOBS[name] = { everyMin, run };
}

export async function runJob(deps: Deps, name: string): Promise<Record<string, unknown>> {
  const job = JOBS[name];
  if (!job) throw new Error("unknown job " + name);
  const started = deps.now();
  let result: Record<string, unknown> = {};
  try {
    result = await job.run(deps);
    return result;
  } catch (e) {
    result = { error: errorText(e) };
    await deps.log.error("job:" + name, errorStack(e), { side: "job" });
    throw e;
  } finally {
    await putOp(deps.db, "job:" + name, { at: new Date(started).toISOString(), ms: deps.now() - started, ...result }, new Date(deps.now())).catch(() => {});
  }
}
