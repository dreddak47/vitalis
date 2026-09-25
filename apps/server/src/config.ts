export interface ServerConfig {
  port: number;
  env: "development" | "test" | "production";
  storeBackend: "memory" | "supabase";
  llmProvider: "mock" | "openai";
  ocrProvider: "mock" | "openai";
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  openaiApiKey: string | null;
  openaiBaseUrl: string;
  visionModel: string;
  textModel: string;
  /** OCR mean-confidence below this escalates to the next tier. */
  ocrEscalationThreshold: number;
  /** Field confidence below this sends a fact to the human review queue. */
  fieldReviewThreshold: number;
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): ServerConfig {
  return {
    port: num("PORT", 8787),
    env: (process.env.VITALIS_ENV as ServerConfig["env"]) ?? "development",
    storeBackend: process.env.STORE_BACKEND === "supabase" ? "supabase" : "memory",
    llmProvider: process.env.LLM_PROVIDER === "openai" ? "openai" : "mock",
    ocrProvider: process.env.OCR_PROVIDER === "openai" ? "openai" : "mock",
    supabaseUrl: process.env.SUPABASE_URL ?? null,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? null,
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    visionModel: process.env.VITALIS_VISION_MODEL ?? "gpt-4o",
    textModel: process.env.VITALIS_TEXT_MODEL ?? "gpt-4o-mini",
    ocrEscalationThreshold: num("OCR_CONFIDENCE_ESCALATION_THRESHOLD", 0.72),
    fieldReviewThreshold: num("FIELD_CONFIDENCE_REVIEW_THRESHOLD", 0.8),
  };
}
