/** Scheduled job `empower-auto` (* * * * *, UTC): Auto push to Empower (does nothing while the switch is off). See src/server/jobs. */
import type { Config } from "@netlify/functions";
import { run } from "../../src/server/jobs/netlify";

export default async (): Promise<Response> => run("empower-auto");

export const config: Config = { schedule: "* * * * *" };
