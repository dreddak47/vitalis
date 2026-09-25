/**
 * Field-level extraction accuracy harness.
 *
 * Methodology:
 *
 *   For each document in the labeled corpus, run the real pipeline stage 2
 *   (classification, then domain extraction) through whichever LlmClient the
 *   environment selects — MockLlmClient by default, or a real provider when
 *   LLM_PROVIDER=openai / OPENAI_API_KEY are set (see docs/DEMO_SETUP.md).
 *   Gold labels enumerate the fields a perfect extraction must produce
 *   (e.g. medications[0].dose.amount). A field scores:
 *     1.0  exact match (case/normalization-insensitive for strings)
 *     0.5  present but wrong value
 *     0.0  missing
 *   Extraneous facts cost nothing (precision is reported separately).
 *   accuracy = total points / total gold fields, reported per document kind
 *   and overall, plus classification accuracy for stage 2a.
 *
 * IMPORTANT — mock mode is not an accuracy measurement. MockLlmClient never
 * reads document text; it only echoes a canned block when one is embedded in
 * the fixture (used elsewhere for offline demo/seed data). This corpus's
 * fixtures carry no such block, by design, so a mock run scores ~0% and that
 * is the CORRECT, expected result — it proves the harness isn't leaking
 * answers into the mock path. Only a REAL provider run produces a number
 * worth citing. Every run is stamped with which mode produced it and written
 * to fixtures/results/ so the number has an auditable, reproducible trail.
 *
 * Run: npm run eval -w @vitalis/server
 * Real run: set LLM_PROVIDER=openai + OPENAI_API_KEY (+ OPENAI_BASE_URL /
 *   VITALIS_TEXT_MODEL for non-OpenAI OpenAI-compatible endpoints) in .env.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ExtractionResult } from "@vitalis/shared";
import { createLlmClient } from "../ai/llm.js";
import { loadConfig } from "../config.js";
import { ExtractionAgent } from "../pipeline/extract.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(here, "fixtures", "corpus");
const GOLD_DIR = path.join(here, "fixtures", "gold");
const RESULTS_DIR = path.join(here, "fixtures", "results");

const goldFieldSchema = z.object({
  path: z.string(), // e.g. "medications[0].drugName"
  expected: z.union([z.string(), z.number()]),
});

const goldSchema = z.object({
  documentFile: z.string(),
  kind: z.string(),
  note: z.string().optional(),
  fields: z.array(goldFieldSchema),
});
type Gold = z.infer<typeof goldSchema>;

// ---------------------------------------------------------------------------

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function getPath(obj: unknown, dotted: string): unknown {
  const m = dotted.match(/^(?<coll>\w+)\[(?<idx>\d+)\]\.(?<field>[\w.]+)$/);
  const groups = m?.groups;
  if (!groups?.coll || !groups.idx || !groups.field) return undefined;
  const coll = (obj as Record<string, unknown>)[groups.coll];
  if (!Array.isArray(coll)) return undefined;
  const item = coll[Number(groups.idx)];
  if (!item || typeof item !== "object") return undefined;

  // navigate (possibly nested) field, unwrapping { value, confidence }
  // wrappers at every step so dose.amount reaches into the wrapped object
  const unwrap = (n: unknown): unknown =>
    n && typeof n === "object" && "value" in n && "confidence" in n
      ? (n as { value: unknown }).value
      : n;
  let node: unknown = item;
  for (const part of groups.field.split(".")) {
    node = unwrap(node);
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return unwrap(node);
}

function norm(v: unknown): string | number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = v.toLowerCase().replace(/[^a-z0-9.]+/g, " ").trim();
    const asNum = Number(n);
    return Number.isFinite(asNum) && n !== "" ? asNum : n;
  }
  return null;
}

function scoreField(actual: unknown, expected: string | number): number {
  const a = norm(actual);
  const e = norm(expected);
  if (a === null || a === undefined) return 0;
  if (a === e) return 1;
  if (typeof a === "string" && typeof e === "string" && (a.includes(e) || e.includes(a))) return 1;
  return 0.5; // field exists but value mismatch
}

// ---------------------------------------------------------------------------

interface DocResult {
  file: string;
  kind: string;
  classifiedCorrectly: boolean;
  points: number;
  fields: number;
  accuracyPct: number;
  misses: string[];
}

async function main(): Promise<void> {
  const config = loadConfig();
  const isMock = config.llmProvider === "mock";
  const llm = createLlmClient(config);
  const agent = new ExtractionAgent(llm, config.textModel);

  const goldFiles = (await readdir(GOLD_DIR)).filter((f) => f.endsWith(".json"));
  if (goldFiles.length === 0) {
    console.error(`no gold files in ${GOLD_DIR}`);
    process.exit(1);
  }

  console.log("\nVitalis extraction eval");
  console.log("=".repeat(60));
  if (isMock) {
    console.log(
      "MODE: mock — MockLlmClient does not read document text.\n" +
        "      This corpus carries no embedded answer key, so a low/zero\n" +
        "      score below is EXPECTED and proves no leakage, not accuracy.\n" +
        "      Set LLM_PROVIDER=openai (+ OPENAI_API_KEY) for a real number."
    );
  } else {
    console.log(`MODE: real — provider=${config.llmProvider} model=${config.textModel}`);
  }
  console.log("=".repeat(60));

  const results: DocResult[] = [];
  let totalPoints = 0;
  let totalFields = 0;
  let classifyCorrect = 0;
  const byKind = new Map<string, { points: number; fields: number }>();

  for (const gf of goldFiles.sort()) {
    const gold: Gold = goldSchema.parse(JSON.parse(await readFile(path.join(GOLD_DIR, gf), "utf8")));
    const raw = await readFile(path.join(CORPUS_DIR, gold.documentFile), "utf8");

    const classified = await agent.classify(raw, null);
    const classifiedCorrectly = classified === gold.kind;
    if (classifiedCorrectly) classifyCorrect++;

    const extraction: ExtractionResult = await agent.extract(raw, gold.kind as ExtractionResult["documentKind"]);

    let points = 0;
    const misses: string[] = [];
    for (const f of gold.fields) {
      const s = scoreField(getPath(extraction as JsonValue, f.path), f.expected);
      points += s;
      if (s < 1) {
        misses.push(
          `    ${s === 0 ? "MISS " : "DIFF "} ${f.path}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(getPath(extraction as JsonValue, f.path))}`
        );
      }
    }

    const acc = (points / gold.fields.length) * 100;
    console.log(
      `${gf.padEnd(28)} ${gold.kind.padEnd(18)} class:${classifiedCorrectly ? "OK " : "MISS"}  ${points.toFixed(1)}/${gold.fields.length}  ${acc.toFixed(1)}%`
    );
    misses.forEach((m) => console.log(m));

    results.push({
      file: gf,
      kind: gold.kind,
      classifiedCorrectly,
      points,
      fields: gold.fields.length,
      accuracyPct: acc,
      misses,
    });

    totalPoints += points;
    totalFields += gold.fields.length;
    const agg = byKind.get(gold.kind) ?? { points: 0, fields: 0 };
    agg.points += points;
    agg.fields += gold.fields.length;
    byKind.set(gold.kind, agg);
  }

  console.log("=".repeat(60));
  for (const [kind, agg] of [...byKind.entries()].sort()) {
    console.log(`${kind.padEnd(20)} ${((agg.points / agg.fields) * 100).toFixed(1)}%  (n=${agg.fields})`);
  }
  console.log("-".repeat(60));
  const overallAccuracy = (totalPoints / totalFields) * 100;
  const classificationAccuracy = (classifyCorrect / goldFiles.length) * 100;
  console.log(
    `OVERALL field-level accuracy: ${overallAccuracy.toFixed(1)}% (${totalPoints.toFixed(1)}/${totalFields} fields)`
  );
  console.log(
    `Classification accuracy: ${classificationAccuracy.toFixed(1)}% (${classifyCorrect}/${goldFiles.length} documents)\n`
  );

  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifact = {
    generatedAt: new Date().toISOString(),
    mode: isMock ? "mock" : "real",
    llmProvider: config.llmProvider,
    textModel: config.textModel,
    documentCount: goldFiles.length,
    overallFieldAccuracyPct: Number(overallAccuracy.toFixed(2)),
    classificationAccuracyPct: Number(classificationAccuracy.toFixed(2)),
    byKind: Object.fromEntries(
      [...byKind.entries()].map(([kind, agg]) => [
        kind,
        { accuracyPct: Number(((agg.points / agg.fields) * 100).toFixed(2)), fields: agg.fields },
      ])
    ),
    documents: results,
  };
  const outFile = path.join(RESULTS_DIR, `${stamp}_${isMock ? "mock" : config.textModel.replace(/[/\\]/g, "_")}.json`);
  await writeFile(outFile, JSON.stringify(artifact, null, 2));
  console.log(`Artifact written: ${path.relative(process.cwd(), outFile)}\n`);
}

await main();
