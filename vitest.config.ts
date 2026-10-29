import { defineConfig } from "vitest/config";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    fileParallelism: false, // files share one SQLite data dir
    // Isolated data dir and no model: unit tests must never touch real records or the network.
    env: { VITALIS_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "vitalis-unit-")), LLM_API_KEY: "", HF_TOKEN: "", LLM_BASE_URL: "https://router.huggingface.co/v1" },
  },
});
