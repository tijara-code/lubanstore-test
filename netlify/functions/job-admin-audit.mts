/** Scheduled job `admin-audit` (47 2 * * *, UTC): the admin audit trail kept 180 days. See src/server/domain/admin/jobs.ts. */
import type { Config } from "@netlify/functions";
import { run } from "../../src/server/jobs/netlify";

export default async (): Promise<Response> => run("admin-audit");

export const config: Config = { schedule: "47 2 * * *" };
