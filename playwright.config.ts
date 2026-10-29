import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vitalis-e2e-"));
// Reuse the downloaded Synthea dataset if present, so the demo step doesn't hit the network.
const synthea = path.join(__dirname, "data", "synthea");
if (fs.existsSync(synthea)) fs.cpSync(synthea, path.join(dataDir, "synthea"), { recursive: true });

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "node tests/e2e/mock-llm.mjs", port: 4011, reuseExistingServer: false },
    {
      command: "npx next build && npx next start -p 3100",
      port: 3100,
      timeout: 240_000,
      reuseExistingServer: false,
      env: { NEXT_DIST_DIR: ".next-e2e", VITALIS_DATA_DIR: dataDir, LLM_BASE_URL: "http://localhost:4011/v1", LLM_API_KEY: "test", LLM_MODEL: "mock-medgemma" },
    },
  ],
});
