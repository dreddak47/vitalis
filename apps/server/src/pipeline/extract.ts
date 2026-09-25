import {
  DOCUMENT_KINDS,
  extractionResultSchema,
  type DocumentKind,
  type ExtractionResult,
} from "@vitalis/shared";
import type { LlmClient } from "../ai/llm.js";

/**
 * Stage 2 of the pipeline: turn raw OCR text into validated, structured facts.
 *
 * "Domain-aware agents" here means: per-document-kind prompts and schemas,
 * because the salient fields of a discharge summary differ fundamentally from
 * those of a handwritten prescription. The output contract is always
 * `extractionResultSchema` — the LLM proposes JSON, zod accepts or rejects it,
 * and nothing unvalidated flows downstream.
 */

const CLASSIFY_SYSTEM = `You are a medical document classifier. Given OCR text,
return JSON {"kind": <one of ${DOCUMENT_KINDS.join(" | ")}>} and nothing else.
Use "unknown" rather than guessing.`;

/**
 * JSON Schema handed to providers that support structured outputs. It mirrors
 * `extractionResultSchema` (kept permissive: the zod parse is the real gate).
 */
function jsonSchemaFor(kind: DocumentKind): Record<string, unknown> {
  const field = (value: Record<string, unknown>) => ({
    type: "object",
    properties: {
      value,
      confidence: { type: "number" },
      evidence: { type: ["string", "null"] },
    },
    required: ["value", "confidence"],
  });

  return {
    type: "object",
    properties: {
      documentKind: { const: kind },
      medications: { type: "array", items: { type: "object" } },
      conditions: { type: "array", items: { type: "object" } },
      labResults: { type: "array", items: { type: "object" } },
      vitals: { type: "array", items: { type: "object" } },
      allergies: { type: "array", items: { type: "object" } },
      summary: field({ type: ["string", "null"] }),
    },
    required: ["documentKind"],
  };
}

const EXTRACTION_GUIDANCE: Record<DocumentKind, string> = {
  prescription: `Extract every medication line. Handwritten sig codes apply:
OD=once daily, BD/BID=twice daily, TDS/TID=three times daily, HS=at night,
SOS=as needed. Preserve dose units exactly as written ("T. Dolo 650" → drugName
"Dolo", dose 650 mg). Confidence must reflect handwriting legibility —
illegible drug names get confidence ≤ 0.5, never guess.`,
  lab_report: `Extract every analyte row: name, value, unit, reference interval
when printed, and whether the report flags it. Keep the lab's own units; do
NOT convert. The measuredAt date is the collection date, not print date.`,
  discharge_summary: `Extract final diagnoses as conditions (status active
unless documented resolved), discharge medications, vitals recorded at
discharge, and drug allergies mentioned in the banner/allergy section.`,
  doctor_note: `Extract assessment/diagnoses as conditions, plan medications,
vitals from the exam section, and any new allergies.`,
  radiology_report: `Extract impressions as conditions with status "suspected"
unless the radiologist states them definitively. Extract measurements as
labResults only when a numeric value with units is given.`,
  voice_memo: `This is a transcription of the patient speaking. Extract
self-reported symptoms/measurements as vitals or conditions with reduced
confidence (self-report ≤ 0.8) and note it in the summary.`,
  insurance_claim: `Extract procedure/diagnosis codes as conditions with the
code mapped to icd10 when possible. Do not extract billing amounts.`,
  unknown: `Extract only facts stated explicitly in the text. When the
document type is unclear, prefer empty arrays over speculation.`,
};

export class ExtractionAgent {
  constructor(
    private llm: LlmClient,
    private textModel: string
  ) {}

  async classify(rawText: string, hint: DocumentKind | null): Promise<DocumentKind> {
    if (hint && hint !== "unknown") return hint;
    const res = await this.llm.complete({
      model: this.textModel,
      maxTokens: 64,
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM },
        { role: "user", content: rawText.slice(0, 4000) },
      ],
    });
    const m = res.text.match(/"(?<kind>[a-z_]+)"/);
    const kind = m?.groups?.kind as DocumentKind | undefined;
    return kind && (DOCUMENT_KINDS as readonly string[]).includes(kind) ? kind : "unknown";
  }

  /**
   * Extract structured facts. Throws on schema failure — callers must treat
   * that as a failed job, never persist partial output.
   */
  async extract(rawText: string, kind: DocumentKind): Promise<ExtractionResult> {
    const schema = jsonSchemaFor(kind);
    const res = await this.llm.complete({
      model: this.textModel,
      maxTokens: 4096,
      jsonSchema: { name: "vitalis_extraction", schema },
      messages: [
        {
          role: "system",
          content:
            `You are a clinical information-extraction agent specialized in ${kind.replace(/_/g, " ")}s. ` +
            `Return JSON matching the provided schema. Rules:\n` +
            `- ${EXTRACTION_GUIDANCE[kind]}\n` +
            `- Every field: { value, confidence (0..1), evidence (short verbatim quote) }.\n` +
            `- confidence is your calibrated certainty about THIS value as transcribed.\n` +
            `- Use null for values not present. Never invent data. No PHI beyond the document.`,
        },
        { role: "user", content: rawText },
      ],
    });

    const stripped = res.text
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      throw new Error(
        `extraction produced invalid JSON: ${err instanceof Error ? err.message : err}`
      );
    }
    // The schema is the contract — this is where bad model output dies.
    return extractionResultSchema.parse(parsed);
  }
}
