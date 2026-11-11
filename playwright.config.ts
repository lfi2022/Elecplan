import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: "http://localhost:3107", trace: "retain-on-failure" },
  webServer: {
    command: "node node_modules/tsx/dist/cli.mjs tests/e2e-server.ts",
    url: "http://localhost:3107/api/health",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
