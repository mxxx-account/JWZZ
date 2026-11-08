import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./quality", outputDir: "../reports/quality-2026-11-08-round3/production-browser",
  timeout: 90_000, expect: { timeout: 15_000 }, workers: 1,
  reporter: [["list"], ["json", { outputFile: "../reports/quality-2026-11-08-round3/production-browser.json" }]],
  use: { ...devices["Desktop Edge"], channel: "msedge", baseURL: "http://localhost:3002", screenshot: "on", trace: "retain-on-failure" },
});
