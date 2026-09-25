import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { IngestionService } from "../src/pipeline/ingest.js";
import { TieredOcrEngine, MockOcrProvider } from "../src/pipeline/ocr.js";
import { MockLlmClient } from "../src/ai/llm.js";
import { MemoryStore } from "../src/store/memory.js";
import {
  canonicalAnalyte,
  computeFlag,
  scoreExtraction,
} from "../src/pipeline/normalize.js";
import { compileReport } from "../src/report/compiler.js";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  extractionResultSchema,
  type ExtractionResult,
} from "@vitalis/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
// Dedicated mock-pipeline fixtures (bytes carry an embedded MockLlmClient
// answer key) — deliberately separate from src/eval/fixtures/corpus, which
// is a real, answer-key-free accuracy corpus meant to be scored by an actual
// LLM. Mixing the two would either make this plumbing test depend on a real
// provider, or leak gold answers into the accuracy eval's prompts.
const FIXTURES = path.join(here, "fixtures", "mock");

const config = {
  ...loadConfig(),
  env: "test" as const,
  storeBackend: "memory" as const,
  llmProvider: "mock" as const,
  ocrProvider: "mock" as const,
};

function makePipeline() {
  const store = new MemoryStore();
  const ocr = new TieredOcrEngine(new MockOcrProvider(), config.ocrEscalationThreshold);
  const ingestion = new IngestionService(store, config, new MockLlmClient(), ocr);
  return { store, ingestion, ocr };
}

test("tiered OCR: prefers embedded text layer", async () => {
  const { ocr } = makePipeline();
  const out = await ocr.run({
    bytes: Buffer.from("ignored"),
    mimeType: "application/pdf",
    embeddedText: "Fast digital PDF text that is definitely longer than forty characters.",
    looksHandwritten: false,
  });
  assert.equal(out.tier, "tier1_text_layer");
  assert.equal(out.confidence, 0.99);
  assert.equal(out.attempts.length, 1);
});

test("tiered OCR: handwritten short-circuits to vision model", async () => {
  const { ocr } = makePipeline();
  const out = await ocr.run({
    bytes: Buffer.from("scrawled ink"),
    mimeType: "image/jpeg",
    embeddedText: null,
    looksHandwritten: true,
  });
  assert.equal(out.tier, "tier3_vision_model");
  assert.equal(out.attempts[0]?.escalatedBecause?.includes("handwriting"), true);
});

test("tiered OCR: low classical confidence escalates to vision", async () => {
  const { ocr } = makePipeline();
  const corrupted = "lab � � � report � � � " + "�".repeat(200);
  const out = await ocr.run({
    bytes: Buffer.from(corrupted),
    mimeType: "image/png",
    embeddedText: null,
    looksHandwritten: false,
  });
  assert.equal(out.tier, "tier3_vision_model");
  assert.ok(out.attempts.some((a) => a.escalatedBecause?.includes("confidence")));
});

test("extraction schema rejects malformed model output", () => {
  const bad = JSON.stringify({ documentKind: "prescription", medications: [{ nope: 1 }] });
  assert.throws(() => extractionResultSchema.parse(JSON.parse(bad)));
});

test("ingest end-to-end: bytes -> facts with provenance", async () => {
  const { store, ingestion } = makePipeline();
  const raw = await readFile(path.join(FIXTURES, "rx_01.txt"));
  const outcome = await ingestion.ingest({
    userId: "u1",
    title: "Rx Jan",
    mimeType: "image/jpeg",
    bytes: raw,
    recordedAt: "2026-01-12",
  });
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.document.kind, "prescription");

  const facts = await store.getFacts("u1");
  assert.equal(facts.medications.length, 3);
  const met = facts.medications.find((m) => m.drugName === "Metformin");
  assert.ok(met);
  assert.equal(met.documentId, outcome.document.id); // provenance preserved
  assert.deepEqual(met.dose, { amount: 500, unit: "mg" });
  assert.equal(met.status, "discontinued"); // has an end date

  const jobs = await store.listJobsForDocument("u1", outcome.document.id);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.status, "succeeded");
  assert.ok((jobs[0]?.meanConfidence ?? 0) > 0.5);
});

test("ingest is idempotent for byte-identical uploads", async () => {
  const { store, ingestion } = makePipeline();
  const raw = await readFile(path.join(FIXTURES, "lab_01.txt"));
  const first = await ingestion.ingest({
    userId: "u1", title: "lab", mimeType: "application/pdf",
    bytes: raw, recordedAt: "2026-01-20",
  });
  const second = await ingestion.ingest({
    userId: "u1", title: "lab again", mimeType: "application/pdf",
    bytes: raw, recordedAt: "2026-01-20",
  });
  assert.equal(first.document.id, second.document.id);
  assert.equal((await store.listDocuments("u1")).length, 1);
});

test("low-confidence documents route to needs_review", async () => {
  const { ingestion } = makePipeline();
  const raw = await readFile(path.join(FIXTURES, "rx_handwritten_01.txt"));
  const outcome = await ingestion.ingest({
    userId: "u2", title: "handwritten", mimeType: "image/jpeg",
    bytes: raw, recordedAt: "2026-02-01", looksHandwritten: true,
  });
  assert.equal(outcome.document.ocrTier, "tier3_vision_model");
  assert.equal(outcome.document.status, "needs_review");
});

test("normalization resolves aliases and computes flags", () => {
  assert.equal(canonicalAnalyte({ name: "Glycated Hemoglobin", unit: null, refLow: null, refHigh: null })?.analyte, "hba1c");
  assert.equal(canonicalAnalyte({ name: "completely unknown analyte", unit: null, refLow: null, refHigh: null }), null);
  assert.equal(computeFlag(7.2, 4.0, 5.6), "high");
  assert.equal(computeFlag(5.0, 4.0, 5.6), "normal");
});

test("scoreExtraction blends OCR and field confidence", () => {
  const extraction = extractionResultSchema.parse({
    documentKind: "lab_report",
    labResults: [
      {
        analyte: { value: "TSH", confidence: 0.9, evidence: null },
        value: { value: 2.1, confidence: 0.8, evidence: null },
        unit: { value: null, confidence: 1, evidence: null },
        referenceLow: { value: null, confidence: 1, evidence: null },
        referenceHigh: { value: null, confidence: 1, evidence: null },
        flag: { value: null, confidence: 1, evidence: null },
        measuredAt: { value: null, confidence: 1, evidence: null },
      },
    ],
  }) satisfies ExtractionResult;
  const stats = scoreExtraction(extraction, 0.9, 0.8);
  assert.ok(stats.meanConfidence > 0.75 && stats.meanConfidence <= 0.9);
  assert.equal(stats.fieldsTotal, 2);
});

test("report compiler personalizes sections by persona + preferences", () => {
  const diabetic = compileReport(
    "u1",
    {
      userId: "u1", displayName: "A", dob: "1972-05-01", sex: "male",
      heightCm: 172, weightKg: 80, updatedAt: "2026-01-01T00:00:00Z",
    },
    DEFAULT_DISPLAY_PREFERENCES,
    {
      medications: [{
        id: "m1", userId: "u1", documentId: "d1", drugName: "Metformin",
        dose: { amount: 500, unit: "mg" }, frequency: "1-0-1", route: null,
        prescriber: null, startDate: "2026-01-12", endDate: null, instructions: null,
        status: "active", confidence: 0.97, verification: "auto_verified", createdAt: "",
      }],
      conditions: [{
        id: "c1", userId: "u1", documentId: "d1", name: "Type 2 Diabetes Mellitus",
        icd10: "E11", status: "active", diagnosedAt: "2024-03-01",
        confidence: 0.95, verification: "auto_verified", createdAt: "",
      }],
      labResults: [{
        id: "l1", userId: "u1", documentId: "d2", analyte: "hba1c", displayName: "Hemoglobin A1c",
        value: 7.2, unit: "%", referenceLow: 4, referenceHigh: 5.6, flag: "high",
        measuredAt: "2026-01-20", confidence: 0.99, verification: "auto_verified", createdAt: "",
      }],
      vitals: [],
      allergies: [],
    },
    []
  );

  const kinds = diabetic.sections.map((s) => s.kind);
  assert.ok(kinds.includes("lab_trends"));
  assert.ok(kinds.includes("risk_flags"));
  assert.ok(kinds.includes("preventive_care"));
  assert.ok(diabetic.persona.tags.includes("diabetic"));

  // Diabetic persona should put HbA1c in the trend series
  const trends = diabetic.sections.find((s) => s.kind === "lab_trends");
  const series = (trends?.props as { series: Array<{ analyte: string }> }).series;
  assert.ok(series.some((s) => s.analyte === "hba1c"));

  // A healthy young user with no docs gets a much smaller report
  const healthy = compileReport(
    "u2",
    {
      userId: "u2", displayName: "B", dob: "2000-01-01", sex: "female",
      heightCm: null, weightKg: null, updatedAt: "",
    },
    { ...DEFAULT_DISPLAY_PREFERENCES, detailLevel: "at_a_glance" },
    { medications: [], conditions: [], labResults: [], vitals: [], allergies: [] },
    []
  );
  assert.deepEqual(healthy.sections.map((s) => s.kind), ["headline"]);
});
