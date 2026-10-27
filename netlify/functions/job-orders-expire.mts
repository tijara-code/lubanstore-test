/**
 * Scheduled: card attempts unpaid after 72 hours are cancelled (src/server/jobs/payments.ts).
 * Hourly at minute 17, as the original store ran it.
 */
import type { Config } from "@netlify/functions";
import { getDeps } from "../../src/server/bootstrap";
import { runJob } from "../../src/server/jobs";

export default async (): Promise<Response> => {
  const { deps } = await getDeps(process.env);
  const out = await runJob(deps, "orders-expire");
  return new Response(JSON.stringify({ ok: true, cancelled: out.cancelled ?? 0 }), { headers: { "content-type": "application/json" } });
};

export const config: Config = { schedule: "17 * * * *" };
