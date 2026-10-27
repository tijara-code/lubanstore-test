/**
 * Every HTTP endpoint (the storefront API, webhooks, invoice and reminder pages, the admin
 * API) in one function: the Hono app from src/server/app.ts.
 */
import type { Config, Context } from "@netlify/functions";
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

export const config: Config = {
  path: ["/api/*", "/invoice/*", "/resume/*"],
  preferStatic: false,
};
