/**
 * /.netlify/functions/thawani-webhook — the webhook URL configured in Thawani's merchant
 * portal today (the original store's). The same handler as POST /api/pay/webhook, through
 * the one Hono app (src/server/routes/payments.ts registers the alias path). A failed start
 * answers 503 JSON (Thawani retries) and is retried on the next delivery.
 */
import type { Context } from "@netlify/functions";
import { netlifyHandler } from "../../src/server/bootstrap";

const handle = netlifyHandler();

export default async (req: Request, ctx: Context): Promise<Response> => handle(req, ctx);
