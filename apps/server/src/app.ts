import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { createLlmClient } from "./ai/llm.js";
import type { ServerConfig } from "./config.js";
import { IngestionService } from "./pipeline/ingest.js";
import { TieredOcrEngine } from "./pipeline/ocr.js";
import { createOcrProvider } from "./pipeline/ocr.js";
import { registerRoutes } from "./routes/api.js";
import { createStore } from "./store/index.js";

export interface BuildOptions {
  config: ServerConfig;
}

export async function buildApp({ config }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.env !== "test" });
  await app.register(cors, { origin: true });

  const store = createStore(config);
  const llm = createLlmClient(config);
  const ocr = new TieredOcrEngine(createOcrProvider(config), config.ocrEscalationThreshold);
  const ingestion = new IngestionService(store, config, llm, ocr);

  if (config.env !== "test" && config.storeBackend === "memory") {
    const { seedDemo } = await import("./seed/seed.js");
    await seedDemo(store, ingestion);
  }

  registerRoutes(app, { store, ingestion });
  return app;
}
