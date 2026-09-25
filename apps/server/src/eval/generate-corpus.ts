/**
 * Synthetic gold-corpus generator.
 *
 * Hand-typing a large labeled corpus invites a specific failure mode: a human
 * writes a document, then separately writes its answer key, and the two
 * silently drift (wrong dose copied, a field renamed, a value transposed).
 * This generator avoids that by construction — for each synthetic document it
 * builds one in-memory "facts" object, renders that object into document
 * text AND derives the gold field list from that same object. Text and gold
 * cannot disagree because nothing is transcribed twice.
 *
 * Determinism: a seeded PRNG (mulberry32) means the whole corpus is
 * reproducible — same seed, same 175 documents, forever. Re-running after an
 * edit to a pool/template regenerates everything consistently.
 *
 * Output is additive and namespaced (`gen_<kind>_NN.*`) so it can sit
 * alongside the small hand-authored seed corpus without collisions.
 *
 * Run: npm run eval:gen-corpus -w @vitalis/server
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(here, "fixtures", "corpus");
const GOLD_DIR = path.join(here, "fixtures", "gold");

const TARGET_PER_KIND = 25;
const SEED = 20260915;

// ---------------------------------------------------------------------------
// Deterministic PRNG + sampling helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

const int = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const float = (min: number, max: number, decimals = 1) => {
  const v = rng() * (max - min) + min;
  const p = 10 ** decimals;
  return Math.round(v * p) / p;
};
const choice = <T,>(arr: readonly T[]): T => arr[int(0, arr.length - 1)] as T;
const sampleN = <T,>(arr: readonly T[], n: number): T[] => {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    out.push(...pool.splice(int(0, pool.length - 1), 1));
  }
  return out;
};
const bool = (pTrue = 0.5) => rng() < pTrue;
const isoDate = (year: number, monthMax = 12) =>
  `${year}-${String(int(1, monthMax)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Data pools
// ---------------------------------------------------------------------------

interface DrugSpec {
  name: string;
  doseOptions: Array<{ amount: number; unit: string }>;
  freqOptions: string[];
  instructionsOptions: Array<string | null>;
}
const DRUGS: DrugSpec[] = [
  { name: "Metformin", doseOptions: [{ amount: 500, unit: "mg" }, { amount: 1000, unit: "mg" }], freqOptions: ["1-0-1", "BID", "1-1-1"], instructionsOptions: ["after food", "with meals"] },
  { name: "Glimepiride", doseOptions: [{ amount: 1, unit: "mg" }, { amount: 2, unit: "mg" }], freqOptions: ["1-0-0", "OD"], instructionsOptions: ["before breakfast"] },
  { name: "Atorvastatin", doseOptions: [{ amount: 10, unit: "mg" }, { amount: 20, unit: "mg" }, { amount: 40, unit: "mg" }], freqOptions: ["0-0-1", "HS"], instructionsOptions: ["at night", null] },
  { name: "Amlodipine", doseOptions: [{ amount: 5, unit: "mg" }, { amount: 10, unit: "mg" }], freqOptions: ["1-0-0", "OD"], instructionsOptions: [null, "morning"] },
  { name: "Losartan", doseOptions: [{ amount: 50, unit: "mg" }, { amount: 100, unit: "mg" }], freqOptions: ["1-0-0", "OD"], instructionsOptions: [null] },
  { name: "Telmisartan", doseOptions: [{ amount: 40, unit: "mg" }, { amount: 80, unit: "mg" }], freqOptions: ["1-0-0"], instructionsOptions: [null] },
  { name: "Levothyroxine", doseOptions: [{ amount: 25, unit: "mcg" }, { amount: 50, unit: "mcg" }, { amount: 75, unit: "mcg" }, { amount: 100, unit: "mcg" }], freqOptions: ["1-0-0", "OD"], instructionsOptions: ["empty stomach"] },
  { name: "Omeprazole", doseOptions: [{ amount: 20, unit: "mg" }], freqOptions: ["1-0-0", "OD"], instructionsOptions: ["before breakfast"] },
  { name: "Pantoprazole", doseOptions: [{ amount: 40, unit: "mg" }], freqOptions: ["1-0-0"], instructionsOptions: ["before breakfast", "empty stomach"] },
  { name: "Sertraline", doseOptions: [{ amount: 50, unit: "mg" }, { amount: 100, unit: "mg" }], freqOptions: ["1-0-0", "OD"], instructionsOptions: [null] },
  { name: "Montelukast", doseOptions: [{ amount: 10, unit: "mg" }], freqOptions: ["0-0-1", "HS"], instructionsOptions: ["at night"] },
  { name: "Doxycycline", doseOptions: [{ amount: 100, unit: "mg" }], freqOptions: ["1-0-1", "BID"], instructionsOptions: ["after food"] },
  { name: "Amoxicillin", doseOptions: [{ amount: 500, unit: "mg" }], freqOptions: ["1-1-1", "TID"], instructionsOptions: ["after food"] },
  { name: "Paracetamol", doseOptions: [{ amount: 500, unit: "mg" }, { amount: 650, unit: "mg" }], freqOptions: ["SOS"], instructionsOptions: ["as needed for fever", "as needed for pain"] },
  { name: "Sumatriptan", doseOptions: [{ amount: 50, unit: "mg" }], freqOptions: ["SOS"], instructionsOptions: ["at onset of migraine"] },
  { name: "Folic Acid", doseOptions: [{ amount: 5, unit: "mg" }], freqOptions: ["1-0-0", "OD"], instructionsOptions: [null] },
];

interface ConditionSpec {
  name: string;
  icd10: string;
}
const CONDITIONS: ConditionSpec[] = [
  { name: "Type 2 Diabetes Mellitus", icd10: "E11.9" },
  { name: "Essential Hypertension", icd10: "I10" },
  { name: "Hypothyroidism", icd10: "E03.9" },
  { name: "Hyperlipidemia", icd10: "E78.5" },
  { name: "Migraine", icd10: "G43.909" },
  { name: "Asthma", icd10: "J45.909" },
  { name: "GERD", icd10: "K21.9" },
  { name: "Osteoarthritis", icd10: "M19.90" },
  { name: "Major Depressive Disorder", icd10: "F32.9" },
  { name: "Chronic Kidney Disease Stage 3", icd10: "N18.3" },
  { name: "Iron Deficiency Anemia", icd10: "D50.9" },
  { name: "Allergic Rhinitis", icd10: "J30.9" },
  { name: "Urinary Tract Infection", icd10: "N39.0" },
];

interface AllergySpec {
  substance: string;
  reaction: string;
  severity: "mild" | "moderate" | "severe";
}
const ALLERGIES: AllergySpec[] = [
  { substance: "Penicillin", reaction: "rash", severity: "moderate" },
  { substance: "Sulfamethoxazole", reaction: "rash", severity: "moderate" },
  { substance: "Ibuprofen", reaction: "hives", severity: "mild" },
  { substance: "Peanuts", reaction: "anaphylaxis", severity: "severe" },
  { substance: "Latex", reaction: "contact dermatitis", severity: "mild" },
  { substance: "Shellfish", reaction: "swelling", severity: "severe" },
  { substance: "Aspirin", reaction: "GI upset", severity: "moderate" },
];

interface AnalyteSpec {
  name: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  decimals: number;
  panel: "metabolic" | "lipid" | "thyroid" | "cbc" | "renal" | "electrolyte" | "liver";
}
const ANALYTES: AnalyteSpec[] = [
  { name: "Hemoglobin A1c", unit: "%", refLow: 4.0, refHigh: 5.6, decimals: 1, panel: "metabolic" },
  { name: "Fasting Glucose", unit: "mg/dL", refLow: 70, refHigh: 99, decimals: 0, panel: "metabolic" },
  { name: "LDL Cholesterol", unit: "mg/dL", refLow: null, refHigh: 100, decimals: 0, panel: "lipid" },
  { name: "HDL Cholesterol", unit: "mg/dL", refLow: 40, refHigh: null, decimals: 0, panel: "lipid" },
  { name: "Triglycerides", unit: "mg/dL", refLow: null, refHigh: 150, decimals: 0, panel: "lipid" },
  { name: "Total Cholesterol", unit: "mg/dL", refLow: null, refHigh: 200, decimals: 0, panel: "lipid" },
  { name: "TSH", unit: "mIU/L", refLow: 0.4, refHigh: 4.0, decimals: 1, panel: "thyroid" },
  { name: "Free T4", unit: "ng/dL", refLow: 0.8, refHigh: 1.8, decimals: 1, panel: "thyroid" },
  { name: "Hemoglobin", unit: "g/dL", refLow: 12.0, refHigh: 15.5, decimals: 1, panel: "cbc" },
  { name: "WBC Count", unit: "x10^3/uL", refLow: 4.0, refHigh: 11.0, decimals: 1, panel: "cbc" },
  { name: "Platelet Count", unit: "x10^3/uL", refLow: 150, refHigh: 410, decimals: 0, panel: "cbc" },
  { name: "Creatinine", unit: "mg/dL", refLow: 0.6, refHigh: 1.3, decimals: 1, panel: "renal" },
  { name: "BUN", unit: "mg/dL", refLow: 7, refHigh: 20, decimals: 0, panel: "renal" },
  { name: "Sodium", unit: "mmol/L", refLow: 135, refHigh: 145, decimals: 0, panel: "electrolyte" },
  { name: "Potassium", unit: "mmol/L", refLow: 3.5, refHigh: 5.1, decimals: 1, panel: "electrolyte" },
  { name: "ALT", unit: "U/L", refLow: 7, refHigh: 56, decimals: 0, panel: "liver" },
  { name: "AST", unit: "U/L", refLow: 8, refHigh: 48, decimals: 0, panel: "liver" },
];

const DOCTORS = ["Dr. S. Mehta", "Dr. Priya Nair", "Dr. A. Iyer", "Dr. K. Sharma", "Dr. R. Fernandes", "Dr. M. Rao", "Dr. L. Chen", "Dr. J. Okafor"];
const LABS = ["City Diagnostics", "Metropolis Pathlabs", "Sunrise Clinical Laboratory", "Meridian Labs", "Northview Diagnostics"];
const HOSPITALS = ["Riverside General Hospital", "Lakeside Medical Center", "St. Anne's Hospital", "Greenfield Regional Medical Center", "Harborview Hospital"];
const IMAGING_CENTERS = ["Clarity Imaging Center", "Metro Diagnostic Imaging", "Summit Radiology", "Pinnacle Imaging Associates"];
const SYMPTOMS = ["dizziness", "headache", "fatigue", "nausea", "joint pain", "foot burning", "palpitations", "shortness of breath", "insomnia", "low mood"];

const VITAL_KINDS = ["blood_pressure", "heart_rate", "weight", "temperature", "spo2"] as const;

function randomVital(): { kind: (typeof VITAL_KINDS)[number]; value: number; valueSecondary: number | null; unit: string } {
  const kind = choice(VITAL_KINDS);
  switch (kind) {
    case "blood_pressure":
      return { kind, value: int(110, 160), valueSecondary: int(65, 100), unit: "mmHg" };
    case "heart_rate":
      return { kind, value: int(58, 108), valueSecondary: null, unit: "bpm" };
    case "weight":
      return { kind, value: int(48, 105), valueSecondary: null, unit: "kg" };
    case "temperature":
      return { kind, value: float(97.0, 101.2, 1), valueSecondary: null, unit: "F" };
    case "spo2":
      return { kind, value: int(93, 99), valueSecondary: null, unit: "%" };
  }
}

// ---------------------------------------------------------------------------
// Gold field type + generic sampling of analyte values
// ---------------------------------------------------------------------------

type GoldField = { path: string; expected: string | number };

function sampleAnalyteValue(a: AnalyteSpec): { value: number; flag: "low" | "normal" | "high" } {
  const roll = rng();
  if (a.refLow !== null && roll < 0.25) {
    const v = a.refLow - Math.max(a.refLow * 0.15, 1);
    return { value: Math.round(v * 10 ** a.decimals) / 10 ** a.decimals, flag: "low" };
  }
  if (a.refHigh !== null && roll > 0.7) {
    const v = a.refHigh + Math.max(a.refHigh * 0.2, 1);
    return { value: Math.round(v * 10 ** a.decimals) / 10 ** a.decimals, flag: "high" };
  }
  const lo = a.refLow ?? (a.refHigh ?? 10) * 0.6;
  const hi = a.refHigh ?? (a.refLow ?? 10) * 1.4;
  return { value: float(lo, hi, a.decimals), flag: "normal" };
}

// ---------------------------------------------------------------------------
// Per-kind generators — each returns { text, gold }
// ---------------------------------------------------------------------------

function genLabReport(idx: number): { text: string; gold: GoldField[] } {
  const panel = choice(["metabolic", "lipid", "thyroid", "cbc", "renal"] as const);
  const candidates = ANALYTES.filter((a) => a.panel === panel || (panel === "metabolic" && a.panel === "lipid"));
  const rows = sampleN(candidates.length >= 4 ? candidates : ANALYTES, int(4, Math.min(6, candidates.length >= 4 ? candidates.length : ANALYTES.length)));
  const lab = choice(LABS);
  const date = isoDate(2025 + int(0, 1));
  const lines = rows.map((a) => {
    const { value, flag } = sampleAnalyteValue(a);
    const rangeStr = a.refLow !== null && a.refHigh !== null ? `${a.refLow} - ${a.refHigh}` : a.refLow !== null ? `> ${a.refLow}` : a.refHigh !== null ? `< ${a.refHigh}` : "-";
    const flagStr = flag === "high" ? "H" : flag === "low" ? "L" : "";
    return { a, value, flag, line: `${a.name.padEnd(24)} ${String(value).padEnd(10)} ${a.unit.padEnd(10)} ${rangeStr.padEnd(18)} ${flagStr}` };
  });
  const text = [
    `${lab.toUpperCase()} — FINAL REPORT`,
    `Patient: Synthetic Patient ${idx}       Collected: ${date}`,
    "",
    "Test                       Result      Units      Reference          Flag",
    ...lines.map((l) => l.line),
    "",
    "End of report.",
  ].join("\n");

  const gold: GoldField[] = [];
  lines.forEach((l, i) => {
    gold.push({ path: `labResults[${i}].analyte`, expected: l.a.name });
    gold.push({ path: `labResults[${i}].value`, expected: l.value });
    if (l.flag !== "normal") gold.push({ path: `labResults[${i}].flag`, expected: l.flag });
  });
  return { text, gold };
}

function genPrescription(idx: number, handwritten: boolean): { text: string; gold: GoldField[] } {
  const doctor = choice(DOCTORS);
  const meds = sampleN(DRUGS, int(2, 3));
  const date = isoDate(2025 + int(0, 1));
  const withAllergy = bool(0.3);
  const allergy = withAllergy ? choice(ALLERGIES) : null;
  const illegibleSig = handwritten && bool(0.5);

  const medLines = meds.map((d) => {
    const dose = choice(d.doseOptions);
    const freq = choice(d.freqOptions);
    const instr = choice(d.instructionsOptions);
    return { d, dose, freq, instr };
  });

  const rxBody = medLines
    .map((m, i) => `${i + 1}. ${handwritten ? "T." : "Tab."} ${m.d.name} ${m.dose.amount}${m.dose.unit} — ${m.freq}${m.instr ? ` (${m.instr})` : ""}`)
    .join("\n");

  const text = [
    handwritten ? "(scanned handwritten prescription — variable stroke width)" : `${doctor}, MD`,
    handwritten ? "" : `Reg No: MED/${int(10000, 99999)}                     Date: ${date}`,
    "",
    `Patient: Synthetic Patient ${idx}        Age/Sex: ${int(22, 78)}/${choice(["M", "F"])}`,
    allergy ? `Known allergy: ${allergy.substance} (${allergy.reaction})` : "",
    "",
    "Rx",
    rxBody,
    "",
    illegibleSig ? "� illegible signature �" : `[Signed] ${doctor.replace("Dr. ", "")}`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const gold: GoldField[] = [];
  medLines.forEach((m, i) => {
    gold.push({ path: `medications[${i}].drugName`, expected: m.d.name });
    gold.push({ path: `medications[${i}].dose.amount`, expected: m.dose.amount });
    gold.push({ path: `medications[${i}].dose.unit`, expected: m.dose.unit });
    if (!handwritten) gold.push({ path: `medications[${i}].frequency`, expected: m.freq });
    if (m.instr) gold.push({ path: `medications[${i}].instructions`, expected: m.instr });
  });
  if (allergy) {
    gold.push({ path: "allergies[0].substance", expected: allergy.substance });
    gold.push({ path: "allergies[0].reaction", expected: allergy.reaction });
  }
  if (!illegibleSig && !handwritten) {
    gold.push({ path: "medications[0].prescriber", expected: doctor });
  }
  return { text, gold };
}

const CHRONIC_CONDITIONS = new Set([
  "Type 2 Diabetes Mellitus",
  "Essential Hypertension",
  "Hypothyroidism",
  "Hyperlipidemia",
  "Asthma",
  "GERD",
  "Osteoarthritis",
  "Major Depressive Disorder",
  "Chronic Kidney Disease Stage 3",
]);

function genDischargeSummary(idx: number): { text: string; gold: GoldField[] } {
  const hospital = choice(HOSPITALS);
  const principal = choice(CONDITIONS);
  // Chronic conditions are managed, not "resolved" — only acute-tending ones can be.
  const resolved = CHRONIC_CONDITIONS.has(principal.name) ? false : bool(0.5);
  const secondary = choice(CONDITIONS.filter((c) => c.name !== principal.name));
  const meds = sampleN(DRUGS, int(1, 3));
  const vital = randomVital();
  const withAllergy = bool(0.35);
  const allergy = withAllergy ? choice(ALLERGIES) : null;
  const admit = isoDate(2025 + int(0, 1));

  const medLines = meds.map((d) => ({ d, dose: choice(d.doseOptions) }));

  const text = [
    `${hospital.toUpperCase()}`,
    "DISCHARGE SUMMARY",
    "",
    `Patient: Synthetic Patient ${idx}          Age/Sex: ${int(25, 82)}/${choice(["M", "F"])}`,
    `Admission: ${admit}       Discharge: ${admit}`,
    "",
    "FINAL DIAGNOSIS:",
    `1. ${principal.name}${resolved ? ", resolved" : ", ongoing management"}`,
    `2. ${secondary.name}`,
    allergy ? `3. New ${allergy.substance} allergy (${allergy.reaction} on exposure)` : "",
    "",
    "DISCHARGE MEDICATIONS:",
    ...medLines.map((m, i) => `${i + 1}. Tab ${m.d.name} ${m.dose.amount} ${m.dose.unit} — ${choice(m.d.freqOptions)}`),
    "",
    `VITALS AT DISCHARGE: ${vital.kind === "blood_pressure" ? `BP ${vital.value}/${vital.valueSecondary} ${vital.unit}` : `${vital.kind.replace("_", " ")} ${vital.value} ${vital.unit}`}`,
    "",
    "FOLLOW-UP: As advised by treating physician.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const gold: GoldField[] = [
    { path: "conditions[0].name", expected: principal.name },
    { path: "conditions[0].status", expected: resolved ? "resolved" : "active" },
    { path: "conditions[1].name", expected: secondary.name },
  ];
  medLines.forEach((m, i) => {
    gold.push({ path: `medications[${i}].drugName`, expected: m.d.name });
    gold.push({ path: `medications[${i}].dose.amount`, expected: m.dose.amount });
  });
  if (vital.kind === "blood_pressure") {
    gold.push({ path: "vitals[0].value", expected: vital.value });
    gold.push({ path: "vitals[0].valueSecondary", expected: vital.valueSecondary as number });
  } else {
    gold.push({ path: "vitals[0].value", expected: vital.value });
  }
  if (allergy) {
    gold.push({ path: "allergies[0].substance", expected: allergy.substance });
    gold.push({ path: "allergies[0].reaction", expected: allergy.reaction });
  }
  return { text, gold };
}

function genDoctorNote(idx: number): { text: string; gold: GoldField[] } {
  const doctor = choice(DOCTORS);
  const suspected = bool(0.3);
  const condition = choice(CONDITIONS);
  const vital = randomVital();
  const med = choice(DRUGS);
  const dose = choice(med.doseOptions);
  const withAllergy = bool(0.25);
  const allergy = withAllergy ? choice(ALLERGIES) : null;
  const date = isoDate(2025 + int(0, 1));

  const text = [
    `${doctor} — Follow-up Visit Note`,
    `Date: ${date}                Patient: Synthetic Patient ${idx} (${int(20, 75)}/${choice(["M", "F"])})`,
    "",
    `S: Patient reports symptoms consistent with ${condition.name.toLowerCase()}. ${allergy ? `Reports ${allergy.reaction} after taking ${allergy.substance} previously.` : "No new complaints otherwise."}`,
    "",
    `O: ${vital.kind === "blood_pressure" ? `BP ${vital.value}/${vital.valueSecondary} ${vital.unit}` : `${vital.kind.replace("_", " ")} ${vital.value} ${vital.unit}`}. Exam otherwise unremarkable.`,
    "",
    `A: ${condition.name}${suspected ? " — suspected, pending confirmation" : " — active"}`,
    "",
    `P: Start ${med.name} ${dose.amount} ${dose.unit} ${choice(med.freqOptions)}. Follow up in ${choice(["2 weeks", "4 weeks", "6 weeks", "3 months"])}.`,
  ].join("\n");

  const gold: GoldField[] = [
    { path: "conditions[0].name", expected: condition.name },
    { path: "conditions[0].status", expected: suspected ? "suspected" : "active" },
    { path: "vitals[0].value", expected: vital.value },
    { path: "medications[0].drugName", expected: med.name },
    { path: "medications[0].dose.amount", expected: dose.amount },
  ];
  if (vital.kind === "blood_pressure") gold.push({ path: "vitals[0].valueSecondary", expected: vital.valueSecondary as number });
  if (allergy) {
    gold.push({ path: "allergies[0].substance", expected: allergy.substance });
    gold.push({ path: "allergies[0].reaction", expected: allergy.reaction });
  }
  return { text, gold };
}

interface RadiologyTemplate {
  modality: string;
  finding: string;
  measurement: { label: string; unit: string };
}
const RADIOLOGY_TEMPLATES: RadiologyTemplate[] = [
  { modality: "Chest X-Ray (PA view)", finding: "cardiomegaly", measurement: { label: "transverse cardiac diameter", unit: "cm" } },
  { modality: "MRI Lumbar Spine", finding: "L4-L5 disc bulge", measurement: { label: "disc bulge", unit: "mm" } },
  { modality: "CT Abdomen", finding: "cholelithiasis", measurement: { label: "largest calculus", unit: "mm" } },
  { modality: "CT Chest", finding: "pulmonary nodule", measurement: { label: "nodule", unit: "mm" } },
  { modality: "Ultrasound Abdomen", finding: "hepatic steatosis", measurement: { label: "liver span", unit: "cm" } },
];

function genRadiologyReport(idx: number): { text: string; gold: GoldField[] } {
  const t = choice(RADIOLOGY_TEMPLATES);
  const center = choice(IMAGING_CENTERS);
  const date = isoDate(2025 + int(0, 1));
  const value = t.measurement.unit === "cm" ? float(2, 16, 1) : int(3, 15);

  const text = [
    `${center.toUpperCase()}`,
    `${t.modality.toUpperCase()} — REPORT`,
    "",
    `Patient: Synthetic Patient ${idx}            Study Date: ${date}`,
    `Referred by: ${choice(DOCTORS)}`,
    "",
    `FINDINGS: ${t.finding}, ${t.measurement.label} ${value} ${t.measurement.unit}. Remaining study unremarkable.`,
    "",
    `IMPRESSION: Findings suggestive of ${t.finding}. Recommend clinical correlation.`,
  ].join("\n");

  const gold: GoldField[] = [
    { path: "conditions[0].name", expected: t.finding },
    { path: "conditions[0].status", expected: "suspected" },
    { path: "labResults[0].value", expected: value },
    { path: "labResults[0].unit", expected: t.measurement.unit },
  ];
  return { text, gold };
}

function genVoiceMemo(idx: number): { text: string; gold: GoldField[] } {
  const symptoms = sampleN(SYMPTOMS, int(1, 2));
  const withVital = bool(0.5);
  const vital = withVital ? randomVital() : null;
  const date = isoDate(2025 + int(0, 1));

  const symptomSentence =
    symptoms.length === 1
      ? `I've been having some ${symptoms[0]} the last couple of days`
      : `I've been having some ${symptoms[0]} and some ${symptoms[1]} the last couple of days`;

  const vitalSentence = vital
    ? vital.kind === "blood_pressure"
      ? `Also checked my blood pressure at home, it read ${vital.value} over ${vital.valueSecondary}.`
      : `Also, my ${vital.kind.replace("_", " ")} this morning was ${vital.value} ${vital.unit}.`
    : "";

  const text = [
    `[Voice memo transcript — self-recorded, ${date}]`,
    "",
    `Hey, just a quick note. ${symptomSentence}. ${vitalSentence} Wanted to mention it before my next visit.`,
  ].join("\n");

  const gold: GoldField[] = symptoms.map((s, i) => ({ path: `conditions[${i}].name`, expected: s }));
  if (vital) {
    gold.push({ path: "vitals[0].value", expected: vital.value });
    if (vital.kind === "blood_pressure") gold.push({ path: "vitals[0].valueSecondary", expected: vital.valueSecondary as number });
  }
  return { text, gold };
}

function genInsuranceClaim(idx: number): { text: string; gold: GoldField[] } {
  const conditions = sampleN(CONDITIONS, int(1, 2));
  const provider = choice(HOSPITALS);
  const date = isoDate(2025 + int(0, 1));

  const text = [
    "SUNGUARD HEALTH INSURANCE",
    "CLAIM FORM — SECTION B: DIAGNOSIS & PROCEDURE",
    "",
    `Claimant: Synthetic Patient ${idx}                Claim No: SG-${2025 + int(0, 1)}-${int(1000, 9999)}`,
    `Date of Service: ${date}`,
    "",
    ...conditions.map((c) => `Diagnosis Code (ICD-10): ${c.icd10} — ${c.name}`),
    "",
    `Procedure: Office visit, established patient (CPT ${choice(["99213", "99214", "99215"])})`,
    "",
    `Provider: ${provider}`,
    "Authorized Signature: ______________________",
  ].join("\n");

  const gold: GoldField[] = conditions.flatMap((c, i) => [
    { path: `conditions[${i}].name`, expected: c.name },
    { path: `conditions[${i}].icd10`, expected: c.icd10 },
  ]);
  return { text, gold };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

interface KindPlan {
  kind: string;
  filePrefix: string;
  count: number;
  gen: (idx: number) => { text: string; gold: GoldField[] };
}

async function main(): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const existingCorpusFiles = await readdir(CORPUS_DIR).catch(() => [] as string[]);
  const existingByKindCount = (kindGuess: (f: string) => boolean) =>
    existingCorpusFiles.filter(kindGuess).length;

  // Existing hand-authored files, matched by their known naming convention.
  const existingCounts = {
    lab_report: existingByKindCount((f) => /^lab_\d+\.txt$/.test(f)),
    prescription: existingByKindCount((f) => /^rx_(handwritten_)?\d+\.txt$/.test(f)),
    discharge_summary: existingByKindCount((f) => /^discharge_\d+\.txt$/.test(f)),
    doctor_note: existingByKindCount((f) => /^note_\d+\.txt$/.test(f)),
    radiology_report: existingByKindCount((f) => /^radiology_\d+\.txt$/.test(f)),
    voice_memo: existingByKindCount((f) => /^voice_\d+\.txt$/.test(f)),
    insurance_claim: existingByKindCount((f) => /^claim_\d+\.txt$/.test(f)),
  } satisfies Record<string, number>;

  const plans: KindPlan[] = [
    { kind: "lab_report", filePrefix: "gen_lab", count: TARGET_PER_KIND - existingCounts.lab_report, gen: genLabReport },
    { kind: "prescription", filePrefix: "gen_rx", count: Math.ceil((TARGET_PER_KIND - existingCounts.prescription) * 0.6), gen: (i) => genPrescription(i, false) },
    { kind: "prescription", filePrefix: "gen_rx_hw", count: Math.floor((TARGET_PER_KIND - existingCounts.prescription) * 0.4), gen: (i) => genPrescription(i, true) },
    { kind: "discharge_summary", filePrefix: "gen_discharge", count: TARGET_PER_KIND - existingCounts.discharge_summary, gen: genDischargeSummary },
    { kind: "doctor_note", filePrefix: "gen_note", count: TARGET_PER_KIND - existingCounts.doctor_note, gen: genDoctorNote },
    { kind: "radiology_report", filePrefix: "gen_radiology", count: TARGET_PER_KIND - existingCounts.radiology_report, gen: genRadiologyReport },
    { kind: "voice_memo", filePrefix: "gen_voice", count: TARGET_PER_KIND - existingCounts.voice_memo, gen: genVoiceMemo },
    { kind: "insurance_claim", filePrefix: "gen_claim", count: TARGET_PER_KIND - existingCounts.insurance_claim, gen: genInsuranceClaim },
  ];

  await mkdir(CORPUS_DIR, { recursive: true });
  await mkdir(GOLD_DIR, { recursive: true });

  let written = 0;
  for (const plan of plans) {
    for (let i = 1; i <= plan.count; i++) {
      const idx = 1000 + written; // globally unique synthetic patient index
      const { text, gold } = plan.gen(idx);
      const fileBase = `${plan.filePrefix}_${String(i).padStart(2, "0")}`;
      await writeFile(path.join(CORPUS_DIR, `${fileBase}.txt`), text + "\n");
      await writeFile(
        path.join(GOLD_DIR, `${fileBase}.json`),
        JSON.stringify({ documentFile: `${fileBase}.txt`, kind: plan.kind, fields: gold }, null, 2) + "\n"
      );
      written++;
    }
  }

  console.log(`Generated ${written} synthetic documents (seed=${SEED}).`);
  console.log("Existing hand-authored counts:", existingCounts);
  console.log("Run `npm run eval -w @vitalis/server` (with a real LLM_PROVIDER) to score the full corpus.");
}

await main();
