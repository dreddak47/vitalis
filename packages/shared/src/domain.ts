/**
 * Core domain model for Vitalis.
 *
 * Design principles:
 *  - Every extracted fact carries provenance (which document, which model run,
 *    which confidence) so nothing enters the record without an audit trail.
 *  - Facts are immutable once verified; corrections create new versions.
 *  - All AI output is validated against zod schemas before it touches the DB —
 *    the model proposes, the schema disposes.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DOCUMENT_KINDS = [
  "lab_report",
  "prescription",
  "discharge_summary",
  "doctor_note",
  "radiology_report",
  "voice_memo",
  "insurance_claim",
  "unknown",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type DocumentStatus =
  | "uploaded" // stored, not yet processed
  | "processing"
  | "needs_review" // extracted, but some fields below review threshold
  | "processed" // extracted and verified/auto-accepted
  | "failed";

export interface DocumentRecord {
  id: string;
  userId: string;
  kind: DocumentKind;
  title: string;
  mimeType: string;
  storagePath: string | null;
  /** SHA-256 of the original bytes — dedupe + tamper evidence. */
  contentHash: string;
  /** Date the document refers to (e.g. visit date), not the upload date. */
  recordedAt: string; // ISO date
  status: DocumentStatus;
  /** Present when an image/document page was transformed into raw text. */
  rawText: string | null;
  /** How the raw text was obtained; null when not yet processed. */
  ocrTier: OcrTier | null;
  createdAt: string;
}

/**
 * Tiered OCR strategy. We always try the cheapest tier that can succeed and
 * escalate only when evidence says the cheaper tier failed.
 */
export type OcrTier =
  | "tier1_text_layer" // digital PDFs: text already embedded in the file
  | "tier2_classical_ocr" // clean scans: Tesseract / cloud vision-ocr
  | "tier3_vision_model"; // handwriting, stamps, low-quality: multimodal LLM

// ---------------------------------------------------------------------------
// Extracted medical facts
// ---------------------------------------------------------------------------

/**
 * Every field the AI extracts is wrapped with confidence + provenance.
 */
export const fieldSchema = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    /** 0..1. Fields below FIELD_REVIEW_THRESHOLD are surfaced for human review. */
    confidence: z.number().min(0).max(1),
    /** Short quote/region of the source document supporting the value. */
    evidence: z.string().nullable().default(null),
  });

export type Field<T> = {
  value: T | null;
  confidence: number;
  evidence: string | null;
};

const doseSchema = z.object({
  amount: z.number().positive(),
  unit: z.string(), // mg, mcg, IU, mL, puff, tablet...
});

export const medicationSchema = z.object({
  drugName: fieldSchema(z.string()),
  dose: fieldSchema(doseSchema).nullable(),
  frequency: fieldSchema(z.string()).nullable(), // "1-0-1", "BID", "once daily at night"
  route: fieldSchema(z.string()).nullable(),
  prescriber: fieldSchema(z.string()).nullable(),
  startDate: fieldSchema(z.string()).nullable(), // ISO date
  endDate: fieldSchema(z.string()).nullable(),
  /** Instructions like "after food", "sos", "taper over 2 weeks". */
  instructions: fieldSchema(z.string()).nullable(),
});
export type ExtractedMedication = z.infer<typeof medicationSchema>;

export const conditionSchema = z.object({
  name: fieldSchema(z.string()),
  /** ICD-10 code if resolvable; null until normalization step fills it. */
  icd10: fieldSchema(z.string()).nullable(),
  status: fieldSchema(z.enum(["active", "resolved", "suspected"])).nullable(),
  diagnosedAt: fieldSchema(z.string()).nullable(),
});
export type ExtractedCondition = z.infer<typeof conditionSchema>;

export const labResultSchema = z.object({
  analyte: fieldSchema(z.string()), // "Hemoglobin A1c", "LDL cholesterol"
  value: fieldSchema(z.number()).nullable(),
  unit: fieldSchema(z.string()).nullable(),
  referenceLow: fieldSchema(z.number()).nullable(),
  referenceHigh: fieldSchema(z.number()).nullable(),
  flag: fieldSchema(z.enum(["low", "normal", "high", "critical"])).nullable(),
  measuredAt: fieldSchema(z.string()).nullable(),
});
export type ExtractedLabResult = z.infer<typeof labResultSchema>;

export const vitalSchema = z.object({
  kind: fieldSchema(
    z.enum(["blood_pressure", "heart_rate", "weight", "height", "spo2", "temperature"])
  ),
  /** For BP this is systolic; pair with valueSecondary (diastolic). */
  value: fieldSchema(z.number()).nullable(),
  valueSecondary: fieldSchema(z.number()).nullable(),
  unit: fieldSchema(z.string()).nullable(),
  measuredAt: fieldSchema(z.string()).nullable(),
});
export type ExtractedVital = z.infer<typeof vitalSchema>;

export const allergySchema = z.object({
  substance: fieldSchema(z.string()),
  reaction: fieldSchema(z.string()).nullable(),
  severity: fieldSchema(z.enum(["mild", "moderate", "severe"])).nullable(),
});
export type ExtractedAllergy = z.infer<typeof allergySchema>;

/**
 * The union output of an extraction run. The doc-type-specific agent fills the
 * buckets relevant to its domain; the compiler downstream does not care which
 * document a fact came from, only that it is schema-valid and sourced.
 */
export const extractionResultSchema = z.object({
  documentKind: z.enum(DOCUMENT_KINDS),
  medications: z.array(medicationSchema).default([]),
  conditions: z.array(conditionSchema).default([]),
  labResults: z.array(labResultSchema).default([]),
  vitals: z.array(vitalSchema).default([]),
  allergies: z.array(allergySchema).default([]),
  /** Free-form summary of the document, used in the documents digest section. */
  summary: fieldSchema(z.string()).nullable().default(null),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

// ---------------------------------------------------------------------------
// Verified records (what actually lands in the user's record store)
// ---------------------------------------------------------------------------

export type VerificationState = "unverified" | "auto_verified" | "human_verified";

interface RecordBase {
  id: string;
  userId: string;
  documentId: string; // provenance — never optional
  confidence: number; // aggregate field confidence at acceptance time
  verification: VerificationState;
  createdAt: string;
}

export interface MedicationRecord extends RecordBase {
  drugName: string;
  dose: { amount: number; unit: string } | null;
  frequency: string | null;
  route: string | null;
  prescriber: string | null;
  startDate: string | null;
  endDate: string | null;
  instructions: string | null;
  status: "active" | "discontinued";
}

export interface ConditionRecord extends RecordBase {
  name: string;
  icd10: string | null;
  status: "active" | "resolved" | "suspected" | null;
  diagnosedAt: string | null;
}

export interface LabResultRecord extends RecordBase {
  analyte: string; // normalized canonical name (e.g. "hba1c", "ldl_c")
  displayName: string;
  value: number | null;
  unit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  flag: "low" | "normal" | "high" | "critical" | null;
  measuredAt: string | null;
}

export interface VitalRecord extends RecordBase {
  kind: "blood_pressure" | "heart_rate" | "weight" | "height" | "spo2" | "temperature";
  value: number | null;
  valueSecondary: number | null;
  unit: string | null;
  measuredAt: string | null;
}

export interface AllergyRecord extends RecordBase {
  substance: string;
  reaction: string | null;
  severity: "mild" | "moderate" | "severe" | null;
}

export interface HealthRecords {
  medications: MedicationRecord[];
  conditions: ConditionRecord[];
  labResults: LabResultRecord[];
  vitals: VitalRecord[];
  allergies: AllergyRecord[];
}

// ---------------------------------------------------------------------------
// Profile & preferences
// ---------------------------------------------------------------------------

export interface UserProfile {
  userId: string;
  displayName: string;
  dob: string | null; // ISO date — age drives persona rules in the compiler
  sex: "female" | "male" | "intersex" | "unknown" | null;
  heightCm: number | null;
  weightKg: number | null;
  updatedAt: string;
}

/**
 * User-controlled display preferences — the input that makes reports
 * *preference-based* rather than a static dashboard.
 */
export const displayPreferencesSchema = z.object({
  /** Overall verbosity of the generated report. */
  detailLevel: z.enum(["at_a_glance", "standard", "deep_dive"]).default("standard"),
  /** Domains the user explicitly wants tracked; empty = infer from data. */
  focusAreas: z
    .array(
      z.enum([
        "heart_health",
        "metabolic", // diabetes / thyroid / lipids
        "medications",
        "vitals",
        "mental_health",
        "preventive_care",
        "allergies",
      ])
    )
    .default([]),
  showTrends: z.boolean().default(true),
  showReferenceRanges: z.boolean().default(true),
  /** Lay explanations vs clinical terminology. */
  language: z.enum(["plain", "clinical"]).default("plain"),
  /** Units for display. */
  units: z.enum(["metric", "imperial"]).default("metric"),
});
export type DisplayPreferences = z.infer<typeof displayPreferencesSchema>;

/** Privacy / retention controls — the "privacy-first" promise, in data. */
export const retentionPolicySchema = z.object({
  /** Auto-delete raw uploaded files after N days (facts are kept). null = keep forever. */
  rawFileRetentionDays: z.number().int().positive().nullable().default(365),
  /** Delete extracted facts together with the source document. */
  factsExpireWithDocument: z.boolean().default(false),
  /** Allow de-identified data to improve models. Default false: opt-in only. */
  allowTrainingUse: z.boolean().default(false),
});
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences =
  displayPreferencesSchema.parse({});
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = retentionPolicySchema.parse({});
