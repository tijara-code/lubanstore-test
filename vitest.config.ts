import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" } },
      { test: { name: "server", include: ["tests/server/**/*.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 60_000 } },
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
