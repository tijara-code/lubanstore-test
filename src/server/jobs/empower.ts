/**
 * Empower's scheduled jobs.
 *
 *   empower-auto   every minute: the auto push. Does nothing while the switch is off (one
 *                  ops read; the last real run's record is left as it was). A scheduled run
 *                  may take 30 s; it uses 24.
 *   empower-poll   at :07 and :37: asks Omniful where the parcels in flight are (read only).
 */
import { autoPush } from "../domain/empower/push";
import { pollStatuses, POLL_MAX } from "../domain/empower/sync";
import { AUTO_RUN_KEY, noteRun, omf, POLL_KEY } from "../domain/empower/store";
import { defineJob } from "./index";

export const AUTO_BUDGET_MS = 24_000;
export const POLL_BUDGET_MS = 6_500;

defineJob("empower-auto", 1, async (deps) => {
  const began = deps.now();
  const out: Record<string, unknown> = { ...(await autoPush(deps, { deadline: began + AUTO_BUDGET_MS - 4000 })) };
  out.ms = deps.now() - began;
  out.at = new Date(began).toISOString();
  if (out.skipped !== "off") await noteRun(deps, AUTO_RUN_KEY, out);
  /* the job record names no order ids — counts only */
  return {
    ok: !out.error,
    skipped: out.skipped || undefined,
    pushed: Number(out.pushed) || 0,
    flagged: Array.isArray(out.flagged) ? out.flagged.length : 0,
    failed: Array.isArray(out.failed) ? out.failed.length : 0,
    ms: out.ms,
  };
});

defineJob("empower-poll", 30, async (deps) => {
  const began = deps.now();
  if (!omf(deps).configured()) {
    await noteRun(deps, POLL_KEY, { skipped: "not_configured" });
    return { ok: true, skipped: "not_configured" };
  }
  const out: Record<string, unknown> = { ...(await pollStatuses(deps, { max: POLL_MAX, deadline: began + POLL_BUDGET_MS })) };
  out.ms = deps.now() - began;
  await noteRun(deps, POLL_KEY, out);
  return {
    ok: !out.error,
    tracked: out.tracked,
    updated: out.updated,
    moved: out.moved,
    errors: Array.isArray(out.errors) ? (out.errors as Array<{ error: string; detail: string }>).map((e) => ({ error: e.error, detail: e.detail })) : undefined,
    ms: out.ms,
  };
});
