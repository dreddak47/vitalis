// Canonical lab/vital catalog. First code is canonical; extra codes are Synthea/LOINC variants of the same test.
// Default reference ranges are typical adult ranges, used only when the lab report gives none.
export type Group =
  | "diabetes" | "kidney" | "lipids" | "cbc" | "liver" | "electrolytes"
  | "thyroid" | "vitals" | "cardiac" | "vitamins";

export type TestDef = {
  codes: string[];
  name: string;
  aliases: string[];
  unit: string;
  low?: number;
  high?: number;
  group: Group;
  // other unit (normalized) -> multiply by this to get canonical unit
  convert?: Record<string, number>;
};

export const TESTS: TestDef[] = [
  { codes: ["4548-4", "17856-6"], name: "HbA1c", aliases: ["hba1c", "a1c", "glycated hemoglobin", "glycated hb", "glycosylated hemoglobin", "hemoglobin a1c"], unit: "%", low: 4, high: 5.6, group: "diabetes" },
  { codes: ["2345-7", "2339-0", "1558-6"], name: "Glucose", aliases: ["glucose", "fasting glucose", "blood sugar", "fasting blood sugar", "fbs", "plasma glucose", "blood glucose"], unit: "mg/dL", low: 70, high: 99, group: "diabetes", convert: { "mmol/l": 18.016 } },
  { codes: ["2160-0", "38483-4"], name: "Creatinine", aliases: ["creatinine", "serum creatinine", "s creatinine"], unit: "mg/dL", low: 0.6, high: 1.3, group: "kidney", convert: { "umol/l": 1 / 88.4 } },
  { codes: ["33914-3", "62238-1", "98979-8"], name: "eGFR", aliases: ["egfr", "gfr", "glomerular filtration rate", "estimated gfr"], unit: "mL/min/1.73m2", low: 60, group: "kidney" },
  { codes: ["3094-0", "6299-2"], name: "Urea nitrogen (BUN)", aliases: ["bun", "urea nitrogen", "blood urea nitrogen"], unit: "mg/dL", low: 7, high: 20, group: "kidney" },
  { codes: ["14959-1", "9318-7"], name: "Urine albumin/creatinine", aliases: ["microalbumin", "uacr", "albumin creatinine ratio", "microalbumin creatinine ratio", "acr"], unit: "mg/g", high: 30, group: "kidney" },
  { codes: ["2093-3"], name: "Total cholesterol", aliases: ["total cholesterol", "cholesterol", "cholesterol total", "serum cholesterol"], unit: "mg/dL", high: 200, group: "lipids", convert: { "mmol/l": 38.67 } },
  { codes: ["18262-6", "13457-7", "2089-1"], name: "LDL cholesterol", aliases: ["ldl", "ldl cholesterol", "ldl c", "ldl direct", "ldl calculated"], unit: "mg/dL", high: 100, group: "lipids", convert: { "mmol/l": 38.67 } },
  { codes: ["2085-9"], name: "HDL cholesterol", aliases: ["hdl", "hdl cholesterol", "hdl c"], unit: "mg/dL", low: 40, group: "lipids", convert: { "mmol/l": 38.67 } },
  { codes: ["2571-8"], name: "Triglycerides", aliases: ["triglycerides", "triglyceride", "tg", "trigs"], unit: "mg/dL", high: 150, group: "lipids", convert: { "mmol/l": 88.57 } },
  { codes: ["718-7"], name: "Hemoglobin", aliases: ["hemoglobin", "haemoglobin", "hb", "hgb"], unit: "g/dL", low: 12, high: 17.5, group: "cbc", convert: { "g/l": 0.1 } },
  { codes: ["4544-3"], name: "Hematocrit", aliases: ["hematocrit", "haematocrit", "hct", "pcv", "packed cell volume"], unit: "%", low: 36, high: 50, group: "cbc" },
  { codes: ["6690-2"], name: "White blood cells", aliases: ["wbc", "white blood cells", "leukocytes", "total leukocyte count", "tlc", "white cell count"], unit: "10^3/uL", low: 4, high: 11, group: "cbc", convert: { "/ul": 0.001, "/mm3": 0.001, "cells/ul": 0.001 } },
  { codes: ["789-8"], name: "Red blood cells", aliases: ["rbc", "red blood cells", "erythrocytes", "rbc count", "red cell count"], unit: "10^6/uL", low: 4.2, high: 5.9, group: "cbc" },
  { codes: ["777-3"], name: "Platelets", aliases: ["platelets", "platelet count", "plt"], unit: "10^3/uL", low: 150, high: 450, group: "cbc", convert: { "lakh/mm3": 100, "lakhs/cumm": 100, "/ul": 0.001, "/mm3": 0.001 } },
  { codes: ["787-2"], name: "MCV", aliases: ["mcv", "mean corpuscular volume"], unit: "fL", low: 80, high: 100, group: "cbc" },
  { codes: ["2951-2", "2947-0"], name: "Sodium", aliases: ["sodium", "na", "serum sodium"], unit: "mmol/L", low: 135, high: 145, group: "electrolytes", convert: { "meq/l": 1 } },
  { codes: ["2823-3", "6298-4"], name: "Potassium", aliases: ["potassium", "k", "serum potassium"], unit: "mmol/L", low: 3.5, high: 5.1, group: "electrolytes", convert: { "meq/l": 1 } },
  { codes: ["2075-0", "2069-3"], name: "Chloride", aliases: ["chloride", "cl"], unit: "mmol/L", low: 98, high: 107, group: "electrolytes", convert: { "meq/l": 1 } },
  { codes: ["17861-6", "49765-1"], name: "Calcium", aliases: ["calcium", "ca", "serum calcium", "total calcium"], unit: "mg/dL", low: 8.5, high: 10.5, group: "electrolytes", convert: { "mmol/l": 4.008 } },
  { codes: ["1742-6"], name: "ALT (SGPT)", aliases: ["alt", "sgpt", "alanine aminotransferase", "alt sgpt"], unit: "U/L", low: 7, high: 56, group: "liver", convert: { "iu/l": 1 } },
  { codes: ["1920-8"], name: "AST (SGOT)", aliases: ["ast", "sgot", "aspartate aminotransferase", "ast sgot"], unit: "U/L", low: 10, high: 40, group: "liver", convert: { "iu/l": 1 } },
  { codes: ["6768-6"], name: "Alkaline phosphatase", aliases: ["alkaline phosphatase", "alp", "alk phos"], unit: "U/L", low: 44, high: 147, group: "liver", convert: { "iu/l": 1 } },
  { codes: ["1975-2"], name: "Bilirubin, total", aliases: ["bilirubin", "total bilirubin", "bilirubin total", "t bilirubin"], unit: "mg/dL", low: 0.1, high: 1.2, group: "liver", convert: { "umol/l": 1 / 17.1 } },
  { codes: ["1751-7"], name: "Albumin", aliases: ["albumin", "serum albumin"], unit: "g/dL", low: 3.5, high: 5, group: "liver", convert: { "g/l": 0.1 } },
  { codes: ["3016-3", "11580-8"], name: "TSH", aliases: ["tsh", "thyroid stimulating hormone", "thyrotropin", "tsh ultrasensitive"], unit: "mIU/L", low: 0.4, high: 4, group: "thyroid", convert: { "uiu/ml": 1, "miu/ml": 1000 } },
  { codes: ["3024-7"], name: "Free T4", aliases: ["free t4", "ft4", "free thyroxine", "t4 free"], unit: "ng/dL", low: 0.8, high: 1.8, group: "thyroid", convert: { "pmol/l": 1 / 12.87 } },
  { codes: ["2276-4"], name: "Ferritin", aliases: ["ferritin", "serum ferritin"], unit: "ng/mL", low: 20, high: 250, group: "cbc", convert: { "ug/l": 1 } },
  { codes: ["89579-7", "10839-9"], name: "Troponin I", aliases: ["troponin", "troponin i", "hs troponin i", "trop i"], unit: "pg/mL", high: 40, group: "cardiac", convert: { "ng/l": 1, "ng/ml": 1000 } },
  { codes: ["1989-3", "62292-8"], name: "Vitamin D (25-OH)", aliases: ["vitamin d", "25 oh vitamin d", "25 hydroxy vitamin d", "vit d", "vitamin d3"], unit: "ng/mL", low: 30, high: 100, group: "vitamins", convert: { "nmol/l": 1 / 2.496 } },
  { codes: ["2132-9"], name: "Vitamin B12", aliases: ["vitamin b12", "b12", "cobalamin", "vit b12"], unit: "pg/mL", low: 200, high: 900, group: "vitamins", convert: { "pmol/l": 1.355 } },
  { codes: ["8480-6"], name: "Systolic BP", aliases: ["systolic", "systolic blood pressure", "sbp"], unit: "mmHg", low: 90, high: 129, group: "vitals", convert: { "mm[hg]": 1 } },
  { codes: ["8462-4"], name: "Diastolic BP", aliases: ["diastolic", "diastolic blood pressure", "dbp"], unit: "mmHg", low: 60, high: 80, group: "vitals", convert: { "mm[hg]": 1 } },
  { codes: ["39156-5"], name: "BMI", aliases: ["bmi", "body mass index"], unit: "kg/m2", low: 18.5, high: 24.9, group: "vitals" },
  { codes: ["29463-7"], name: "Weight", aliases: ["weight", "body weight"], unit: "kg", group: "vitals", convert: { lb: 0.4536, lbs: 0.4536 } },
  { codes: ["8867-4"], name: "Heart rate", aliases: ["heart rate", "pulse", "hr"], unit: "bpm", low: 60, high: 100, group: "vitals", convert: { "/min": 1 } },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const normUnit = (u: string) =>
  u.toLowerCase().replace(/µ|μ/g, "u").replace(/\s|\{|\}|\.|_/g, "").replace(/^x/, "").replace(/\*|\^/g, "").replace(/^k\//, "103/");

const byCode = new Map<string, TestDef>();
const byAlias = new Map<string, TestDef>();
for (const t of TESTS) {
  t.codes.forEach((c) => byCode.set(c, t));
  [t.name, ...t.aliases].forEach((a) => byAlias.set(norm(a), t));
}

export const testByCode = (code: string) => byCode.get(code);
export const canonicalCode = (code: string) => byCode.get(code)?.codes[0] ?? code;

/** Match a free-text test name (as printed on a report) to the catalog. */
export function findTest(name: string): TestDef | undefined {
  if (byCode.has(name.trim())) return byCode.get(name.trim());
  // "Glycated Hb (HbA1c)" → try the whole name, the part outside brackets, then the part inside
  const inside = name.match(/\(([^)]*)\)/)?.[1] ?? "";
  for (const variant of [name, name.replace(/\([^)]*\)/g, " "), inside]) {
    const n = norm(variant);
    if (!n) continue;
    if (byAlias.has(n)) return byAlias.get(n);
    // strip qualifiers like "serum", "fasting", "calculated"
    const stripped = n.replace(/\b(serum|plasma|blood|fasting|level|calculated|direct|s|total)\b/g, " ").replace(/\s+/g, " ").trim();
    if (stripped && byAlias.has(stripped)) return byAlias.get(stripped);
  }
}

// One-letter edit distance (insert/delete/substitute).
function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}

/** OCR-typo fallback ("HBac" → HbA1c): exactly one test within one edit whose unit also fits. Caller must still flag it for review. */
export function nearTest(name: string, unit: string): TestDef | undefined {
  const n = norm(name), u = normUnit(unit);
  if (n.length < 3) return undefined;
  const hits = new Set<TestDef>();
  for (const [alias, t] of byAlias) if (oneEdit(n, alias) && (u === normUnit(t.unit) || t.convert?.[u] !== undefined)) hits.add(t);
  return hits.size === 1 ? [...hits][0] : undefined;
}

export type Normalized = { code: string | null; name: string; value: number; unit: string; needsReview: boolean; low?: number; high?: number };

/** Map an extracted row to canonical code + unit. Unknown tests/units are kept but flagged for review. */
export function normalizeResult(name: string, value: number, unit: string, low?: number | null, high?: number | null): Normalized {
  const t = findTest(name);
  if (!t) return { code: null, name, value, unit, needsReview: true, low: low ?? undefined, high: high ?? undefined };
  const u = normUnit(unit || t.unit);
  let factor = 1;
  let needsReview = false;
  if (u !== normUnit(t.unit)) {
    const f = t.convert?.[u];
    if (f === undefined) needsReview = true;
    else factor = f;
  }
  const r = (x: number) => Math.round(x * factor * 100) / 100;
  return {
    code: t.codes[0],
    name: t.name,
    value: needsReview ? value : r(value),
    unit: needsReview ? unit : t.unit,
    needsReview,
    // lab-provided ranges win over catalog defaults
    low: low != null ? (needsReview ? low : r(low)) : t.low,
    high: high != null ? (needsReview ? high : r(high)) : t.high,
  };
}

export type Flag = "low" | "high" | "normal";
export function flag(value: number, low?: number | null, high?: number | null): Flag {
  if (low != null && value < low) return "low";
  if (high != null && value > high) return "high";
  return "normal";
}

// Which medicines plausibly affect which test groups (for trend overlays). Keyword match on lowercase drug name.
export const MED_GROUPS: [RegExp, Group[]][] = [
  [/metformin|insulin|glipizide|glimepiride|gliclazide|sitagliptin|vildagliptin|empagliflozin|dapagliflozin|liraglutide|semaglutide|pioglitazone/, ["diabetes"]],
  [/statin|ezetimibe|fenofibrate|rosuvastatin/, ["lipids"]],
  [/lisinopril|enalapril|ramipril|losartan|telmisartan|olmesartan|amlodipine|metoprolol|atenolol|bisoprolol|hydrochlorothiazide|chlorthalidone|nifedipine/, ["vitals", "kidney"]],
  [/levothyroxine|thyroxine|carbimazole|methimazole/, ["thyroid"]],
  [/ferrous|iron|epoetin|folic|b12|cyanocobalamin/, ["cbc", "vitamins"]],
  [/vitamin d|cholecalciferol|calcitriol/, ["vitamins"]],
  [/clopidogrel|aspirin|nitroglycerin/, ["cardiac"]],
];
export const medGroups = (med: string) => MED_GROUPS.filter(([re]) => re.test(med.toLowerCase())).flatMap(([, g]) => g);
