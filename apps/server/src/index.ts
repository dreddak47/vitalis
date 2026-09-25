import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({ config });

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`vitalis server listening on :${config.port}`);
  console.log(`  store=${config.storeBackend} llm=${config.llmProvider} ocr=${config.ocrProvider}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
