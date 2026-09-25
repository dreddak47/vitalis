import type { ServerConfig } from "../config.js";

export interface LlmMessage {
  role: "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  /** When set, the client must return JSON conforming to this JSON Schema. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible client (works with OpenAI, OpenRouter, vLLM, Ollama…)
// ---------------------------------------------------------------------------

export class OpenAiCompatibleClient implements LlmClient {
  constructor(
    private baseUrl: string,
    private apiKey: string
  ) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0,
    };
    if (req.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: req.jsonSchema.name,
          schema: req.jsonSchema.schema,
          strict: true,
        },
      };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LLM request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model: string;
    };
    return {
      text: json.choices[0]?.message?.content ?? "",
      model: json.model,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Mock client — deterministic, offline. Used by default so the whole system
// runs with zero keys and is reproducible in tests/eval.
//
// Behaviour: it never "understands" arbitrary text. Instead the extraction
// agent passes the raw document text, and the mock replies with the structured
// extraction encoded as a JSON block inside a fenced region when the document
// was produced by the demo seed/fixtures, else a conservative empty result.
// Real deployments swap in OpenAiCompatibleClient via LLM_PROVIDER=openai.
// ---------------------------------------------------------------------------

export class MockLlmClient implements LlmClient {
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const joined = req.messages
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");

    const fenced = joined.match(/```vitalis-extraction\n([\s\S]*?)```/);
    const text = fenced?.[1]
      ? fenced[1].trim()
      : JSON.stringify({
          documentKind: "unknown",
          medications: [],
          conditions: [],
          labResults: [],
          vitals: [],
          allergies: [],
          summary: null,
        });

    return {
      text,
      model: req.model,
      promptTokens: Math.ceil(joined.length / 4),
      completionTokens: Math.ceil(text.length / 4),
    };
  }
}

export function createLlmClient(config: ServerConfig): LlmClient {
  if (config.llmProvider === "openai") {
    if (!config.openaiApiKey) {
      throw new Error("LLM_PROVIDER=openai requires OPENAI_API_KEY");
    }
    return new OpenAiCompatibleClient(config.openaiBaseUrl, config.openaiApiKey);
  }
  return new MockLlmClient();
}
