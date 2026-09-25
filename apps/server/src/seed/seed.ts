import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IngestionService } from "../pipeline/ingest.js";
import type { Store } from "../store/index.js";

export const DEMO_USER_ID = "demo";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "..", "eval", "fixtures", "corpus");

/**
 * Populate the memory store with a believable persona so the UI shows the
 * generative report at its best immediately on first run. All data is
 * synthetic — no real PHI anywhere in this repository.
 */
export async function seedDemo(store: Store, ingestion: IngestionService): Promise<void> {
  const existing = await store.listDocuments(DEMO_USER_ID);
  if (existing.length > 0) return; // already seeded

  await store.saveProfile({
    userId: DEMO_USER_ID,
    displayName: "Demo User",
    dob: "1972-04-18", // 53 — older-adult-adjacent, diabetic persona
    sex: "male",
    heightCm: 172,
    weightKg: 81,
    updatedAt: new Date().toISOString(),
  });
  await store.savePreferences(DEMO_USER_ID, {
    detailLevel: "standard",
    focusAreas: ["metabolic", "medications"],
    showTrends: true,
    showReferenceRanges: true,
    language: "plain",
    units: "metric",
  });
  await store.saveRetention(DEMO_USER_ID, {
    rawFileRetentionDays: 365,
    factsExpireWithDocument: false,
    allowTrainingUse: false,
  });

  const docs = await store.listDocuments(DEMO_USER_ID);
  if (docs.length > 0) return;

  // Type 2 diabetes diagnosis, stated as a doctor-note style text so the
  // conditions list is non-empty and the persona rules fire.
  const note = `Dr. R. Kulkarni — Outpatient Note            2025-11-02
Assessment: Type 2 Diabetes Mellitus (E11) — newly diagnosed.
Essential Hypertension (I10) — BP 142/88 today.
Plan: Start Metformin 500 mg BD. Recheck HbA1c in 3 months.

\`\`\`vitalis-extraction
{
  "documentKind": "doctor_note",
  "medications": [],
  "conditions": [
    { "name": { "value": "Type 2 Diabetes Mellitus", "confidence": 0.97, "evidence": "Type 2 Diabetes Mellitus (E11)" },
      "icd10": { "value": "E11", "confidence": 0.97, "evidence": "E11" },
      "status": { "value": "active", "confidence": 0.95, "evidence": "newly diagnosed" },
      "diagnosedAt": { "value": "2025-11-02", "confidence": 0.9, "evidence": "note date" } },
    { "name": { "value": "Essential Hypertension", "confidence": 0.96, "evidence": "Essential Hypertension (I10)" },
      "icd10": { "value": "I10", "confidence": 0.96, "evidence": "I10" },
      "status": { "value": "active", "confidence": 0.95, "evidence": null },
      "diagnosedAt": { "value": "2025-11-02", "confidence": 0.9, "evidence": "note date" } }
  ],
  "labResults": [],
  "vitals": [
    { "kind": { "value": "blood_pressure", "confidence": 0.97, "evidence": "BP 142/88" },
      "value": { "value": 142, "confidence": 0.97, "evidence": "142" },
      "valueSecondary": { "value": 88, "confidence": 0.97, "evidence": "88" },
      "unit": { "value": "mmHg", "confidence": 0.9, "evidence": null },
      "measuredAt": { "value": "2025-11-02", "confidence": 0.9, "evidence": "note date" } }
  ],
  "allergies": [],
  "summary": { "value": "Newly diagnosed type 2 diabetes and hypertension; started on metformin.", "confidence": 0.93, "evidence": "assessment" }
}
\`\`\`
`;

  await ingestion.ingest({
    userId: DEMO_USER_ID,
    title: "Doctor Note — Diagnosis",
    mimeType: "text/plain",
    bytes: Buffer.from(note),
    recordedAt: "2025-11-02",
    kindHint: "doctor_note",
    embeddedText: note,
  });

  for (const [file, title, date, handwritten] of [
    ["rx_01.txt", "Prescription — Dr. Mehta", "2026-01-12", false],
    ["lab_01.txt", "Metabolic Panel — City Diagnostics", "2026-01-20", false],
    ["rx_handwritten_01.txt", "Handwritten Rx — Fever", "2026-02-03", true],
  ] as const) {
    const bytes = await readFile(path.join(FIXTURES, file));
    await ingestion.ingest({
      userId: DEMO_USER_ID,
      title,
      mimeType: handwritten ? "image/jpeg" : "application/pdf",
      bytes,
      recordedAt: date,
      looksHandwritten: handwritten,
      embeddedText: handwritten ? null : bytes.toString("utf8"),
    });
  }

  await store.audit(DEMO_USER_ID, {
    action: "seed_demo",
    entity: "user",
    entityId: DEMO_USER_ID,
    meta: { documents: 4 },
  });
}
