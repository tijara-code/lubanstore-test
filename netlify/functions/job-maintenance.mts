/** Scheduled job `maintenance` (47 * * * *, UTC): Logs, webhook records, claims and rate-limit rows past their keep are purged. See src/server/jobs. */
import type { Config } from "@netlify/functions";
import { run } from "../../src/server/jobs/netlify";

export default async (): Promise<Response> => run("maintenance");

export const config: Config = { schedule: "47 * * * *" };
