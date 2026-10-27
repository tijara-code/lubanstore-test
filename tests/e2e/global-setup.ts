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
  if (!process.env.LM_E2E_SKIP_BUILD || !existsSync("dist/index.html")) {
    execSync("npm run build", { stdio: "inherit", env: { ...process.env, LM_QUIET_BUILD: "1" } });
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= "/opt/pw-browsers";
  const { startServer } = await import("../../src/server/node");
  const { server, port } = await startServer({
    port: 0,
    env: { ...process.env, SERVICES_MODE: "fake", DATA_DIR: "memory", SITE_URL: "", DATABASE_URL: "" },
  });
  const address = server.address();
  const actual = typeof address === "object" && address ? address.port : port;
  project.provide("baseUrl", `http://localhost:${actual}`);
  return async () => {
    await new Promise<void>((r) => server.close(() => r()));
  };
}
