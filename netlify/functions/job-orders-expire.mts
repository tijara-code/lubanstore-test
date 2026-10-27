/** Scheduled job `orders-expire` (17 * * * *, UTC): Card attempts unpaid after 72 hours are cancelled. See src/server/jobs. */
import type { Config } from "@netlify/functions";
import { run } from "../../src/server/jobs/netlify";

export default async (): Promise<Response> => run("orders-expire");

export const config: Config = { schedule: "17 * * * *" };
