/**
 * The analytics area's scheduled job: `events-rollup`, hourly — first-party events older than
 * 90 days, or beyond the newest 500,000 rows (/api/ev is an open door; a full database is an
 * outage), are added up into `event_hours` (session hashed to 16 characters, the item kept only
 * for the adds and session_start) and deleted, in one statement. The Analytics tab reads events
 * and event_hours together, so "All" still reaches the first visit.
 */
import { purgeEvents } from "../domain/analytics/rollup";
import { defineJob } from "./index";

export const EVENTS_KEEP_DAYS = 90;
export const EVENTS_CAP = 500000;

defineJob("events-rollup", 60, async (deps) => {
  const r = await purgeEvents(deps.db, deps.now(), { days: EVENTS_KEEP_DAYS, cap: EVENTS_CAP });
  return { moved: r.moved };
});
