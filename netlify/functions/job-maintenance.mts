/**
 * Scheduled: the hourly purges — logs, webhook deliveries, once-only claims, spent rate-limit
 * counters (src/server/jobs/orders.ts `maintenance`). Hourly at minute 23.
 */
import type { Config } from "@netlify/functions";
import { run } from "../../src/server/jobs/netlify";
import "../../src/server/jobs/registry";

export default async (): Promise<Response> => run("maintenance");

export const config: Config = { schedule: "23 * * * *" };
