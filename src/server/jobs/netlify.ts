/**
 * Scheduled jobs. Netlify runs each `job-*` export on its schedule; every one goes through
 * runJob (recorded in ops `job:<name>`, which /api/health reads for staleness).
 * Netlify allows one schedule per function file, so each job has its own small file —
 * see netlify/functions/job-*.mts. This module is their shared runner.
 */
import { bootFailure, getDeps } from "../bootstrap";
import { runJob } from "./index";

export async function run(name: string): Promise<Response> {
  let deps;
  try {
    deps = (await getDeps(process.env)).deps;
  } catch (e) {
    return bootFailure(e); // retried at the next run
  }
  try {
    const result = await runJob(deps, name);
    return new Response(JSON.stringify({ ok: true, job: name, ...summary(result) }), { headers: { "content-type": "application/json" } });
  } catch {
    return new Response(JSON.stringify({ ok: false, job: name }), { status: 500, headers: { "content-type": "application/json" } });
  }
}

/** counts only — never order ids or customer details in a scheduler's log */
function summary(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (typeof v === "number" || typeof v === "boolean") out[k] = v;
  return out;
}
