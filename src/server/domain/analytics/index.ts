/**
 * ANALYTICS — what the admin's Analytics tab and Overview read (the admin routes call these;
 * none of them is a route itself):
 *
 *   statsSummary(deps, { range | from/to, country, platform, paid | adsOnly | unpaidOnly })
 *   liveVisitors(deps, { minutes: 5 | 30 | 60 | 180 | "today" })
 *   busyHours(deps, { weekday | "every", metric: "visits" | "orders", …range })
 *   logsList(deps, { days, full, side }) + logsCsv(rows)
 *   trackingHealth(deps)                         today's failures per platform, warnings
 *   catalogueChangeLines(old, new) / recordCatalogueChange / listCatalogueChanges / …
 *   resetStats(deps, confirm)                    Reset data: events and kept hours
 *   AD_LINK_TEMPLATES, utmLink                   the Ad links card
 */
import { sql } from "drizzle-orm";
import type { Deps } from "../../core/deps";
import { eventHours, events } from "../../db/schema";

export { statsSummary, busyHours, busyValues, filterOf, windowOf, type StatsSummary, type SummaryOptions, type BusyGrid, type StatsFilter } from "./summary";
export { liveVisitors, liveKey, LIVE_STEPS, LIVE_WINDOWS, type LiveVisitor } from "./live";
export { logsList, logsCsv, browserOf, type LogRow, type LogGroup } from "./logs";
export {
  catalogueChangeLines, describeChange, changeSentence, catalogueOnly,
  recordCatalogueChange, listCatalogueChanges, deleteCatalogueChange, clearCatalogueChanges, type ChangeEntry,
} from "./changes";
export { trackingHealth } from "../pixels/health";
export { purgeEvents } from "./rollup";
import { rowsOf } from "./rollup";
export { AD_LINK_TEMPLATES, LINK_MEDIUMS, LINK_PAGES, LINK_SOURCES, utmLink, utmWord, ORIGIN_WORD, originLabel, PLATFORM_WORD } from "../../../shared/attribution";

/**
 * Reset data: every analytics event and every kept hour — irreversible, so it will not run on a
 * typo: the caller names the table back (`confirm: "events"`). Orders are not touched.
 */
export async function resetStats(deps: Deps, confirm: unknown): Promise<{ ok: true; deleted: number } | { ok: false; error: "confirm_required" }> {
  if (String(confirm || "") !== "events") return { ok: false, error: "confirm_required" };
  const res = await deps.db.execute(sql`with d as (delete from ${events} returning 1) select count(*)::int as n from d`);
  await deps.db.delete(eventHours);
  return { ok: true, deleted: Number(rowsOf<{ n: unknown }>(res)[0]?.n) || 0 };
}
