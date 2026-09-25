import type { OcrTier } from "@vitalis/shared";
import type { ServerConfig } from "../config.js";

export interface OcrInput {
  /** Raw bytes of the file as uploaded (base64 in transit, Buffer here). */
  bytes: Buffer;
  mimeType: string;
  /**
   * Text layer extracted by the uploader when the file is a digital PDF, or
   * the transcript when the upload is a voice memo. Null for images/scans.
   */
  embeddedText: string | null;
  /**
   * Cheap signal from the uploader or a pre-filter: does this artifact look
   * handwritten? Real deployments compute this with a tiny classifier
   * (e.g. a MobileNet fine-tune) on page thumbnails.
   */
  looksHandwritten: boolean;
}

export interface OcrOutput {
  text: string;
  tier: OcrTier;
  /** Mean token/character confidence of the chosen tier, 0..1. */
  confidence: number;
  /** Tiers attempted, in order, with their confidences — kept for audit. */
  attempts: Array<{ tier: OcrTier; confidence: number; escalatedBecause?: string }>;
}

export interface OcrProvider {
  /** Classical OCR over an image or scanned PDF page. */
  classicalOcr(input: OcrInput): Promise<{ text: string; confidence: number }>;
  /** Vision-LLM transcription of a hard page (handwriting, stamps, tables). */
  visionOcr(input: OcrInput): Promise<{ text: string; confidence: number }>;
}

/**
 * The tiered router. Policy:
 *
 *   tier1  embedded text layer exists and is substantive      → use it (free)
 *   tier2  classical OCR                                      → cheap default
 *   tier3  vision model iff (handwritten) OR (tier2 mean
 *          confidence < escalation threshold)                 → expensive fallback
 *
 * Every escalation decision is evidence-based and recorded in `attempts`, which
 * lands in extraction_jobs via the orchestrator — that audit trail is how the
 * 82%-field-accuracy claim is measured per tier in evaluation.
 */
export class TieredOcrEngine {
  constructor(
    private provider: OcrProvider,
    private escalationThreshold: number
  ) {}

  async run(input: OcrInput): Promise<OcrOutput> {
    const attempts: OcrOutput["attempts"] = [];

    // --- tier 1: embedded text layer (digital PDFs, EHR exports) ----------
    if (input.embeddedText !== null) {
      const usable = input.embeddedText.trim().length >= 40;
      if (usable) {
        const confidence = 0.99;
        attempts.push({ tier: "tier1_text_layer", confidence });
        return {
          text: input.embeddedText.trim(),
          tier: "tier1_text_layer",
          confidence,
          attempts,
        };
      }
      attempts.push({
        tier: "tier1_text_layer",
        confidence: 0.2,
        escalatedBecause: "text layer present but trivially short (<40 chars)",
      });
    }

    // --- tier 3 short-circuit: handwriting never survives classical OCR ----
    if (input.looksHandwritten) {
      const v = await this.provider.visionOcr(input);
      attempts.push({
        tier: "tier2_classical_ocr",
        confidence: 0,
        escalatedBecause: "skipped: handwriting detected by pre-filter",
      });
      attempts.push({ tier: "tier3_vision_model", confidence: v.confidence });
      return { text: v.text, tier: "tier3_vision_model", confidence: v.confidence, attempts };
    }

    // --- tier 2: classical OCR --------------------------------------------
    const c = await this.provider.classicalOcr(input);
    attempts.push({ tier: "tier2_classical_ocr", confidence: c.confidence });
    if (c.confidence >= this.escalationThreshold) {
      return { text: c.text, tier: "tier2_classical_ocr", confidence: c.confidence, attempts };
    }

    // --- tier 3: vision-model fallback ------------------------------------
    const last = attempts[attempts.length - 1];
    if (last) last.escalatedBecause = `confidence ${c.confidence.toFixed(2)} < ${this.escalationThreshold}`;
    const v = await this.provider.visionOcr(input);
    attempts.push({ tier: "tier3_vision_model", confidence: v.confidence });
    return { text: v.text, tier: "tier3_vision_model", confidence: v.confidence, attempts };
  }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/**
 * Mock provider: deterministic and offline.
 *
 * The mock "reads" text embedded in the file bytes themselves: demo fixtures
 * are text/markdown payloads saved with an image-like mime type. Confidence is
 * derived from byte decorruption (e.g. '�' replacement chars) so escalation
 * paths are still exercised meaningfully in tests.
 */
export class MockOcrProvider implements OcrProvider {
  private decode(input: OcrInput): string {
    return input.bytes.toString("utf8");
  }

  private corruption(text: string): number {
    if (text.length === 0) return 1;
    const bad = (text.match(/�/g) ?? []).length;
    return bad / text.length;
  }

  async classicalOcr(input: OcrInput) {
    const text = this.decode(input);
    const confidence = Math.max(0, 0.95 - 3 * this.corruption(text));
    return { text, confidence };
  }

  async visionOcr(input: OcrInput) {
    // The mock vision model "recovers" corrupted bytes the classical pass
    // couldn't — mimicking real behaviour on handwriting.
    const text = this.decode(input).replace(/�/g, "");
    return { text, confidence: 0.93 };
  }
}

/**
 * Production sketch: classical OCR via a document-AI endpoint, vision via the
 * configured OpenAI-compatible multimodal model. Kept deliberately small — the
 * important part is the OcrProvider seam, the router above never changes.
 */
export class RemoteOcrProvider implements OcrProvider {
  constructor(private config: ServerConfig) {}

  async classicalOcr(): Promise<{ text: string; confidence: number }> {
    // Integrate: Google Document AI / Azure AI Document Intelligence / Textract,
    // or self-hosted Tesseract via a sidecar. Each returns per-token confidence
    // which we average. Left unimplemented: requires a cloud account.
    throw new Error(
      "RemoteOcrProvider.classicalOcr not configured. See docs/IMPROVEMENTS.md."
    );
  }

  async visionOcr(input: OcrInput): Promise<{ text: string; confidence: number }> {
    if (!this.config.openaiApiKey) throw new Error("vision OCR requires OPENAI_API_KEY");
    const res = await fetch(`${this.config.openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.visionModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Transcribe the medical document in the image exactly. Preserve line " +
              "breaks, numbers and units. Do not interpret; transcribe only.",
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${input.mimeType};base64,${input.bytes.toString("base64")}`,
                },
              },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`vision OCR failed: ${res.status}`);
    const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    // Vision APIs rarely surface calibrated confidence; use long-run average
    // from eval as a constant prior, and prefer per-field confidence from the
    // extraction stage for review gating.
    return { text: json.choices[0]?.message?.content ?? "", confidence: 0.9 };
  }
}

export function createOcrProvider(config: ServerConfig): OcrProvider {
  return config.ocrProvider === "openai"
    ? new RemoteOcrProvider(config)
    : new MockOcrProvider();
}
