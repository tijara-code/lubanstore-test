/**
 * /.netlify/functions/thawani-webhook — the webhook URL configured in Thawani's merchant
 * portal today (the original store's). The same handler as POST /api/pay/webhook, through
 * the one Hono app (src/server/routes/payments.ts registers the alias path).
 */
import type { Context } from "@netlify/functions";
import { createApp, type App } from "../../src/server/app";
import { getDeps } from "../../src/server/bootstrap";

let app: App | null = null;

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (!app) {
    const { deps } = await getDeps(process.env);
    app = createApp(deps);
  }
  return app.fetch(req);
};
