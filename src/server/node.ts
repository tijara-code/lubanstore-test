/**
 * The Node server: the built site (dist/) plus the API, on one port. Local development
 * (`npm start`, `npm run dev`) and the end-to-end tests run this; production runs the same
 * app inside Netlify Functions.
 */
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "./app";
import { getDeps } from "./bootstrap";
import { SECURITY_HEADERS, staticHeaders } from "./site-headers";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml",
  ".woff2": "font/woff2", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

export const API_PREFIXES = ["/api/", "/invoice/", "/resume/", "/__fake/", "/.netlify/functions/"];

export async function startServer(opts: { port?: number; distDir?: string; env?: Record<string, string | undefined> } = {}) {
  const { deps, world } = await getDeps(opts.env || process.env);
  const api = createApp(deps);
  const dist = path.resolve(opts.distDir || "dist");
  const site = new Hono();
  site.all("*", async (c) => {
    const p = decodeURIComponent(new URL(c.req.url).pathname);
    if (API_PREFIXES.some((x) => p.startsWith(x))) return api.fetch(c.req.raw);
    let file = path.join(dist, p);
    if (!file.startsWith(dist)) return c.text("Forbidden", 403);
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
    const headers: Record<string, string> = { ...SECURITY_HEADERS };
    if (!existsSync(file)) {
      const notFound = path.join(dist, "404.html");
      return new Response(existsSync(notFound) ? readFileSync(notFound) : "Not found", {
        status: 404, headers: { ...headers, "content-type": TYPES[".html"]! },
      });
    }
    Object.assign(headers, staticHeaders(p), { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    return new Response(readFileSync(file), { status: 200, headers });
  });
  const port = opts.port ?? Number(process.env.PORT || 8888);
  const server = serve({ fetch: site.fetch, port });
  await new Promise((r) => setTimeout(r, 50));
  return { server, port, deps, world };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // `npm start` is a local run: the fakes unless SERVICES_MODE says otherwise (the server's own
  // default is live, and fake is refused wherever SITE_ID / NODE_ENV=production says production)
  startServer({ env: { ...process.env, SERVICES_MODE: process.env.SERVICES_MODE || "fake" } }).then(({ port, deps }) => {
    console.log(`Luban & Musk on http://localhost:${port}  (services: ${deps.env.servicesMode})`);
  });
}
