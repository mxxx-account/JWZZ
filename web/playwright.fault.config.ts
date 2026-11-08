import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir:"./fault-quality",outputDir:"../reports/quality-2026-11-08-round3/fault-browser",workers:1,
  timeout:90_000,expect:{timeout:10_000},
  reporter:[["list"],["json",{outputFile:"../reports/quality-2026-11-08-round3/fault-browser.json"}]],
  use:{...devices["Desktop Edge"],channel:"msedge",baseURL:"http://localhost:3000",screenshot:"on",trace:"on"},
});
