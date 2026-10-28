/**
 * End-to-end setup: build the site once (skip with LM_E2E_SKIP_BUILD=1 when dist/ is fresh),
 * then start the real Node server (site + API) on a free port with an in-memory database and
 * the fake services. Suites read the URL with `inject("baseUrl")`.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    baseUrl: string;
  }
}

export default async function setup(project: TestProject) {
  /* LM_E2E_DIST: serve a dist built elsewhere (a worker's own dev build) instead of building dist/ */
  const dist = process.env.LM_E2E_DIST || "dist";
  if (!process.env.LM_E2E_DIST && (!process.env.LM_E2E_SKIP_BUILD || !existsSync("dist/index.html"))) {
    execSync("npm run build", { stdio: "inherit", env: { ...process.env, LM_QUIET_BUILD: "1" } });
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= "/opt/pw-browsers";
  const { startServer } = await import("../../src/server/node");
  const { server, port, deps } = await startServer({
    port: 0,
    distDir: dist,
    env: {
      ...process.env,
      /* the admin panel's sign-in for the admin e2e suites (invented values, test only) */
      ADMIN_USER: "e2e-keeper",
      ADMIN_PASSWORD: "e2e-password-not-a-secret",
      ADMIN_PASSWORD_HASH: "",
      SESSION_SECRET: "e2e-session-secret-0123456789abcdefghij",
      SERVICES_MODE: "fake", DATA_DIR: "memory", SITE_URL: "", DATABASE_URL: "",
    },
  });
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  project.provide("baseUrl", `http://localhost:${actual}`);
  return async () => {
    await new Promise<void>((r) => {
      server.close(() => r());
      // keep-alive sockets (a browser's, an API client's) would hold the close open
      (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    // the in-memory database holds the process open until it is closed
    await (deps.db as unknown as { $client?: { close?: () => Promise<void> } }).$client?.close?.();
  };
}
