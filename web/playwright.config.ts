import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  use: { ...devices["Desktop Edge"], channel: "msedge", baseURL: process.env.TEST_WEB_URL ?? "http://localhost:3000", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
