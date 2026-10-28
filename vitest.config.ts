import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/*
 * `pg`: the whole server suite again on a REAL PostgreSQL through postgres-js (the production
 * driver), when LM_TEST_PG_URL is set (`npm run test:pg`); without it the project runs
 * nothing. The harness module is swapped for tests/helpers/harness-pg.ts: a fresh database per
 * harness, cloned from a template migrated once per run (tests/helpers/pg-global-setup.ts).
 */
const PG_URL = process.env.LM_TEST_PG_URL || "";
const pgHarness = fileURLToPath(new URL("./tests/helpers/harness-pg.ts", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" } },
      { test: { name: "server", include: ["tests/server/**/*.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 60_000 } },
      {
        resolve: { alias: [{ find: /^(\.\.?\/)+(.*\/)?helpers\/harness$/, replacement: pgHarness }] },
        test: {
          name: "pg", include: PG_URL ? ["tests/server/**/*.test.ts"] : ["tests/pg/skipped.test.ts"], environment: "node",
          testTimeout: 60_000, hookTimeout: 120_000, globalSetup: PG_URL ? ["tests/helpers/pg-global-setup.ts"] : [],
          maxWorkers: 4,
        },
      },
      { test: { name: "parity", include: ["tests/parity/**/*.test.ts"], environment: "node", testTimeout: 60_000 } },
      { test: { name: "web", include: ["tests/web/**/*.test.ts"], environment: "happy-dom" } },
      {
        test: {
          name: "e2e", include: ["tests/e2e/**/*.test.ts"], environment: "node",
          testTimeout: 90_000, hookTimeout: 180_000, fileParallelism: false,
          globalSetup: ["tests/e2e/global-setup.ts"]
        }
      }
    ]
  }
});
