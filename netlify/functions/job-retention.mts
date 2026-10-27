/**
 * Scheduled: personal data on orders delivered or cancelled 12 months ago is cleared
 * (src/server/jobs/orders.ts `retention`). Daily, 03:41 Muscat (23:41 UTC), a quiet hour.
 */
import type { Config } from "@netlify/functions";
import { run } from "../../src/server/jobs/netlify";
import "../../src/server/jobs/registry";

export default async (): Promise<Response> => run("retention");

export const config: Config = { schedule: "41 23 * * *" };
