/** Scheduled job `retention` (23 3 * * *, UTC): Customer details cleared on old delivered/cancelled orders (12 months). See src/server/jobs. */
import type { Config } from "@netlify/functions";
import { run } from "../../src/server/jobs/netlify";

export default async (): Promise<Response> => run("retention");

export const config: Config = { schedule: "23 3 * * *" };
