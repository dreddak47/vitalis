import { z } from "zod";

// One OpenAI-compatible client for every backend: Hugging Face (router or Inference Endpoint),
// Ollama / llama.cpp / vLLM on a local machine. Switching is env-only.
const BASE = process.env.LLM_BASE_URL ?? "https://router.huggingface.co/v1";
const KEY = process.env.LLM_API_KEY ?? process.env.HF_TOKEN ?? "";
const MODEL = process.env.LLM_MODEL ?? "google/medgemma-4b-it";

export const llmConfigured = () => Boolean(KEY) || !BASE.includes("huggingface.co");

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type Msg = { role: "system" | "user" | "assistant"; content: string | Part[] };

export class LLMError extends Error {}

export async function chat(messages: Msg[], { maxTokens = 1500, timeoutMs = 120_000 } = {}): Promise<string> {
  if (!llmConfigured()) throw new LLMError("No model configured. Set LLM_API_KEY (Hugging Face token) or point LLM_BASE_URL at a local server.");
  const res = await fetch(`${BASE.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens, temperature: 0 }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    // Body may echo our prompt (health data), so only surface status and a short snippet.
    throw new LLMError(`Model request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Pull the first JSON object/array out of a model reply (models often wrap it in ```json fences or prose). */
export function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[{[]/);
  if (start < 0) throw new LLMError("Model reply had no JSON");
  const open = body[start], close = open === "{" ? "}" : "]";
  const end = body.lastIndexOf(close);
  if (end <= start) throw new LLMError("Model reply had incomplete JSON");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new LLMError("Model reply was not valid JSON");
  }
}

/** Ask for JSON, validate with zod. Throws LLMError on any failure so callers can fall back. */
export async function chatJson<T>(messages: Msg[], schema: z.ZodType<T>, opts?: { maxTokens?: number }): Promise<T> {
  const parsed = schema.safeParse(parseJson(await chat(messages, opts)));
  if (!parsed.success) throw new LLMError(`Model JSON did not match schema: ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
