/** Scheduled job `events-rollup` (41 * * * *, UTC): Analytics events past 90 days are added into hourly totals, then removed. See src/server/jobs. */
import type { Config } from "@netlify/functions";
import { run } from "../../src/server/jobs/netlify";

export default async (): Promise<Response> => run("events-rollup");

export const config: Config = { schedule: "41 * * * *" };
