import type {
  ExtractionResult,
  Field,
  LabResultRecord,
} from "@vitalis/shared";

/**
 * Stage 3: normalization.
 *
 * Raw extraction says "HbA1c", "glycated hemoglobin", "A1c" — three strings,
 * one concept. The report compiler and trend charts need canonical keys, so
 * every fact passes through domain dictionaries here. Real deployments swap
 * these tables for RxNorm / LOINC / ICD-10 lookups; the interface is stable.
 */

/** Canonical analyte registry (mini-LOINC). Keyed by canonical id. */
export const ANALYTES: Record<
  string,
  { displayName: string; unit: string | null; refLow: number | null; refHigh: number | null; aliases: string[] }
> = {
  hba1c: {
    displayName: "Hemoglobin A1c",
    unit: "%",
    refLow: 4.0,
    refHigh: 5.6,
    aliases: ["hba1c", "a1c", "glycated hemoglobin", "glycosylated hemoglobin", "hemoglobin a1c"],
  },
  ldl_c: {
    displayName: "LDL Cholesterol",
    unit: "mg/dL",
    refLow: 0,
    refHigh: 100,
    aliases: ["ldl", "ldl cholesterol", "ldl-c", "low density lipoprotein"],
  },
  hdl_c: {
    displayName: "HDL Cholesterol",
    unit: "mg/dL",
    refLow: 40,
    refHigh: null,
    aliases: ["hdl", "hdl cholesterol", "hdl-c", "high density lipoprotein"],
  },
  triglycerides: {
    displayName: "Triglycerides",
    unit: "mg/dL",
    refLow: 0,
    refHigh: 150,
    aliases: ["triglycerides", "tg"],
  },
  fasting_glucose: {
    displayName: "Fasting Glucose",
    unit: "mg/dL",
    refLow: 70,
    refHigh: 99,
    aliases: ["fasting glucose", "fbs", "fasting blood sugar", "fasting plasma glucose"],
  },
  hemoglobin: {
    displayName: "Hemoglobin",
    unit: "g/dL",
    refLow: 12,
    refHigh: 17.5,
    aliases: ["hemoglobin", "hb", "hgb"],
  },
  creatinine: {
    displayName: "Creatinine",
    unit: "mg/dL",
    refLow: 0.6,
    refHigh: 1.3,
    aliases: ["creatinine", "serum creatinine", "s. creatinine"],
  },
  tsh: {
    displayName: "TSH",
    unit: "mIU/L",
    refLow: 0.4,
    refHigh: 4.0,
    aliases: ["tsh", "thyroid stimulating hormone", "thyrotropin"],
  },
  vitamin_d: {
    displayName: "Vitamin D (25-OH)",
    unit: "ng/mL",
    refLow: 30,
    refHigh: 100,
    aliases: ["vitamin d", "25-oh vitamin d", "25-hydroxyvitamin d", "calcidiol"],
  },
  vitamin_b12: {
    displayName: "Vitamin B12",
    unit: "pg/mL",
    refLow: 200,
    refHigh: 900,
    aliases: ["vitamin b12", "b12", "cobalamin", "cyanocobalamin"],
  },
};

/** Canonical medication registry (mini-RxNorm). */
const MEDICATIONS: Record<string, { canonical: string; aliases: string[] }> = {
  metformin: { canonical: "Metformin", aliases: ["metformin", "glycomet", "glucophage"] },
  atorvastatin: { canonical: "Atorvastatin", aliases: ["atorvastatin", "lipitor", "atorva"] },
  amlodipine: { canonical: "Amlodipine", aliases: ["amlodipine", "norvasc", "amlo"] },
  levothyroxine: { canonical: "Levothyroxine", aliases: ["levothyroxine", "thyronorm", "synthroid", "eltroxin"] },
  paracetamol: { canonical: "Paracetamol", aliases: ["paracetamol", "acetaminophen", "dolo", "tylenol", "crocin"] },
  metoprolol: { canonical: "Metoprolol", aliases: ["metoprolol", "betaloc", "lopressor"] },
  pantoprazole: { canonical: "Pantoprazole", aliases: ["pantoprazole", "pan", "pantocid", "protonix"] },
};

/** Canonical condition registry (mini-ICD10). */
const CONDITIONS: Record<string, { canonical: string; icd10: string; aliases: string[] }> = {
  t2dm: {
    canonical: "Type 2 Diabetes Mellitus",
    icd10: "E11",
    aliases: ["type 2 diabetes", "t2dm", "type ii diabetes", "diabetes mellitus type 2", "dm2"],
  },
  hypertension: {
    canonical: "Essential Hypertension",
    icd10: "I10",
    aliases: ["hypertension", "htn", "high blood pressure", "essential hypertension"],
  },
  hypothyroidism: {
    canonical: "Hypothyroidism",
    icd10: "E03",
    aliases: ["hypothyroidism", "underactive thyroid", "hypothyroid"],
  },
  dyslipidemia: {
    canonical: "Dyslipidemia",
    icd10: "E78",
    aliases: ["dyslipidemia", "hyperlipidemia", "high cholesterol", "hypercholesterolemia"],
  },
  anemia: {
    canonical: "Iron Deficiency Anemia",
    icd10: "D50",
    aliases: ["anemia", "iron deficiency anemia", "ida", "anaemia"],
  },
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function lookup<T extends { aliases: string[] }>(
  table: Record<string, T>,
  name: string
): { key: string; entry: T } | null {
  const n = norm(name);
  for (const [key, entry] of Object.entries(table)) {
    if (entry.aliases.some((a) => n === norm(a) || n.includes(norm(a)))) {
      return { key, entry };
    }
  }
  return null;
}

export function canonicalAnalyte(input: {
  name: string;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
}): { analyte: string; displayName: string; unit: string | null; refLow: number | null; refHigh: number | null } | null {
  const hit = lookup(ANALYTES, input.name);
  if (!hit) return null;
  const { displayName, unit, refLow, refHigh } = hit.entry;
  return {
    analyte: hit.key,
    displayName,
    // prefer document-provided units/ranges; fall back to registry
    unit: input.unit ?? unit,
    refLow: input.refLow ?? refLow,
    refHigh: input.refHigh ?? refHigh,
  };
}

export function canonicalDrug(name: string): string {
  return lookup(MEDICATIONS, name)?.entry.canonical ?? titleCase(name);
}

export function canonicalCondition(name: string): { name: string; icd10: string | null } {
  const hit = lookup(CONDITIONS, name);
  return hit
    ? { name: hit.entry.canonical, icd10: hit.entry.icd10 }
    : { name: titleCase(name), icd10: null };
}

/** Compute the lab flag from normalized reference ranges when the model didn't. */
export function computeFlag(
  value: number | null,
  refLow: number | null,
  refHigh: number | null
): LabResultRecord["flag"] {
  if (value === null) return null;
  if (refLow !== null && value < refLow) return "low";
  if (refHigh !== null && value > refHigh) return "high";
  if (refLow !== null || refHigh !== null) return "normal";
  return null;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
}

// ---------------------------------------------------------------------------
// Confidence bookkeeping — decides unverified vs auto_verified per doc.
// ---------------------------------------------------------------------------

function unwrapFields(extraction: ExtractionResult): Field<unknown>[] {
  const fields: Field<unknown>[] = [];
  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    if ("confidence" in obj && "value" in obj) {
      fields.push(obj as Field<unknown>);
      return;
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(extraction.medications);
  walk(extraction.conditions);
  walk(extraction.labResults);
  walk(extraction.vitals);
  walk(extraction.allergies);
  return fields;
}

export interface ExtractionStats {
  fieldsTotal: number;
  fieldsBelowThreshold: number;
  meanConfidence: number;
  /** Whole-document verdict: auto-accept or route to the review queue. */
  needsReview: boolean;
}

export function scoreExtraction(
  extraction: ExtractionResult,
  ocrConfidence: number,
  reviewThreshold: number
): ExtractionStats {
  const fields = unwrapFields(extraction).filter((f) => f.value !== null);
  const confidences = fields.map((f) => f.confidence);
  const meanField =
    confidences.length === 0
      ? 0
      : confidences.reduce((a, b) => a + b, 0) / confidences.length;
  // Blend field confidence with OCR confidence — a perfectly structured
  // extraction of a badly-read page is still untrustworthy.
  const blended = meanField * 0.7 + ocrConfidence * 0.3;
  const below = confidences.filter((c) => c < reviewThreshold).length;
  return {
    fieldsTotal: confidences.length,
    fieldsBelowThreshold: below,
    meanConfidence: Math.round(blended * 1000) / 1000,
    needsReview: below > 0,
  };
}
