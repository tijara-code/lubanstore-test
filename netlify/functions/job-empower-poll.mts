/** Scheduled job `empower-poll` (7,37 * * * *, UTC): Parcel statuses read from Empower for in-flight orders. See src/server/jobs. */
import type { Config } from "@netlify/functions";
import { run } from "../../src/server/jobs/netlify";

export default async (): Promise<Response> => run("empower-poll");

export const config: Config = { schedule: "7,37 * * * *" };
