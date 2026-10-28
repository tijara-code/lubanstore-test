/**
 * Every HTTP endpoint (the storefront API, webhooks, invoice and reminder pages, the admin
 * API) in one function: the Hono app from src/server/app.ts. A start that fails (refused
 * configuration, database unreachable) answers 503 JSON and is retried on the next request
 * (src/server/bootstrap.ts netlifyHandler).
 */
import type { Config, Context } from "@netlify/functions";
import { netlifyHandler } from "../../src/server/bootstrap";

const handle = netlifyHandler();

export default async (req: Request, _ctx: Context): Promise<Response> => handle(req);

export const config: Config = {
  path: ["/api/*", "/invoice/*", "/resume/*"],
  preferStatic: false,
};
