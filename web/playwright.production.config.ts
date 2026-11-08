import { defineConfig, devices } from "@playwright/test";
const recordDir = process.env.QA_REPORT_DIR ?? "../reports/quality-2026-11-08-round3";
export default defineConfig({
  testDir: "./quality", outputDir: `${recordDir}/production-browser`,
  timeout: 90_000, expect: { timeout: 15_000 }, workers: 1,
  reporter: [["list"], ["json", { outputFile: `${recordDir}/production-browser.json` }]],
  use: { ...devices["Desktop Edge"], channel: "msedge", baseURL: "http://localhost:3002", screenshot: "on", trace: "retain-on-failure" },
});
