import type {
  DocumentKind,
  DocumentRecord,
  OcrTier,
} from "@vitalis/shared";
import type { LlmClient } from "../ai/llm.js";
import type { ServerConfig } from "../config.js";
import type { Store } from "../store/index.js";
import { newId, nowIso, sha256 } from "../util/helpers.js";
import { ExtractionAgent } from "./extract.js";
import {
  canonicalAnalyte,
  canonicalCondition,
  canonicalDrug,
  computeFlag,
  scoreExtraction,
} from "./normalize.js";
import { TieredOcrEngine, type OcrInput } from "./ocr.js";

export interface IngestRequest {
  userId: string;
  title: string;
  mimeType: string;
  /** Raw file bytes. */
  bytes: Buffer;
  /** ISO date the document refers to (visit date etc.). */
  recordedAt: string | null;
  /** Optional uploader hint (from a file-picker category). */
  kindHint?: DocumentKind;
  /** True when a pre-filter classified the page as handwritten. */
  looksHandwritten?: boolean;
  /** Extracted PDF text layer / voice-memo transcript, when available. */
  embeddedText?: string | null;
}

export interface IngestOutcome {
  document: DocumentRecord;
  tier: OcrTier | null;
  needsReview: boolean;
  error?: string;
}

/**
 * The full ingestion pipeline for one document:
 *
 *   bytes ──► tiered OCR ──► classify ──► domain extraction agent
 *         ──► zod validation ──► normalization ──► confidence scoring
 *         ──► store facts (+ job audit row) ──► status: processed | needs_review
 *
 * Idempotent: re-uploading byte-identical content returns the existing document.
 */
export class IngestionService {
  private extractor: ExtractionAgent;

  constructor(
    private store: Store,
    private config: ServerConfig,
    llm: LlmClient,
    private ocr: TieredOcrEngine
  ) {
    this.extractor = new ExtractionAgent(llm, config.textModel);
  }

  async ingest(req: IngestRequest): Promise<IngestOutcome> {
    const contentHash = sha256(req.bytes);
    const dupe = await this.store.findByHash(req.userId, contentHash);
    if (dupe) {
      return { document: dupe, tier: dupe.ocrTier, needsReview: dupe.status === "needs_review" };
    }
    const now = nowIso();
    const doc: DocumentRecord = {
      id: newId(),
      userId: req.userId,
      kind: req.kindHint ?? "unknown",
      title: req.title,
      mimeType: req.mimeType,
      storagePath: null, // set by the route when it persists the raw file
      contentHash,
      recordedAt: req.recordedAt ?? now.slice(0, 10),
      status: "processing",
      rawText: null,
      ocrTier: null,
      createdAt: now,
    };
    await this.store.putDocument(doc);

    const job: {
      id: string;
      documentId: string;
      userId: string;
      ocrTier: string | null;
      model: string;
      status: "queued" | "running" | "succeeded" | "failed";
      meanConfidence: number | null;
      fieldsTotal: number;
      fieldsBelowThreshold: number;
      error: string | null;
      createdAt: string;
      finishedAt: string | null;
    } = {
      id: newId(),
      documentId: doc.id,
      userId: req.userId,
      ocrTier: null,
      model: this.config.textModel,
      status: "running",
      meanConfidence: null,
      fieldsTotal: 0,
      fieldsBelowThreshold: 0,
      error: null,
      createdAt: now,
      finishedAt: null,
    };

    try {
      // --- stage 1: tiered OCR -------------------------------------------
      const ocrInput: OcrInput = {
        bytes: req.bytes,
        mimeType: req.mimeType,
        embeddedText: req.embeddedText ?? null,
        looksHandwritten: req.looksHandwritten ?? false,
      };
      const ocrOut = await this.ocr.run(ocrInput);
      doc.rawText = ocrOut.text;
      doc.ocrTier = ocrOut.tier;
      job.ocrTier = ocrOut.tier;

      // --- stage 2: classify + extract ------------------------------------
      doc.kind = await this.extractor.classify(ocrOut.text, req.kindHint ?? null);
      const extraction = await this.extractor.extract(ocrOut.text, doc.kind);

      // --- stage 3: normalize + score -------------------------------------
      const stats = scoreExtraction(
        extraction,
        ocrOut.confidence,
        this.config.fieldReviewThreshold
      );
      job.meanConfidence = stats.meanConfidence;
      job.fieldsTotal = stats.fieldsTotal;
      job.fieldsBelowThreshold = stats.fieldsBelowThreshold;

      const verification = stats.needsReview ? "unverified" : "auto_verified";
      const docDate = doc.recordedAt;
      await this.store.addFacts(req.userId, {
        medications: extraction.medications.map((m) => ({
          id: newId(),
          userId: req.userId,
          documentId: doc.id,
          drugName: m.drugName.value ? canonicalDrug(m.drugName.value) : "Unknown",
          dose: m.dose?.value ?? null,
          frequency: m.frequency?.value ?? null,
          route: m.route?.value ?? null,
          prescriber: m.prescriber?.value ?? null,
          startDate: m.startDate?.value ?? docDate,
          endDate: m.endDate?.value ?? null,
          instructions: m.instructions?.value ?? null,
          status: m.endDate?.value ? ("discontinued" as const) : ("active" as const),
          confidence: m.drugName.confidence,
          verification,
          createdAt: now,
        })),
        conditions: extraction.conditions.map((c) => {
          const canon = c.name.value ? canonicalCondition(c.name.value) : null;
          return {
            id: newId(),
            userId: req.userId,
            documentId: doc.id,
            name: canon?.name ?? "Unknown",
            icd10: c.icd10?.value ?? canon?.icd10 ?? null,
            status: c.status?.value ?? "active",
            diagnosedAt: c.diagnosedAt?.value ?? docDate,
            confidence: c.name.confidence,
            verification,
            createdAt: now,
          };
        }),
        labResults: extraction.labResults.flatMap((l) => {
          if (!l.analyte.value) return [];
          const canon = canonicalAnalyte({
            name: l.analyte.value,
            unit: l.unit?.value ?? null,
            refLow: l.referenceLow?.value ?? null,
            refHigh: l.referenceHigh?.value ?? null,
          });
          if (!canon) return []; // unknown analyte — skip rather than guess
          return [
            {
              id: newId(),
              userId: req.userId,
              documentId: doc.id,
              analyte: canon.analyte,
              displayName: canon.displayName,
              value: l.value?.value ?? null,
              unit: canon.unit,
              referenceLow: canon.refLow,
              referenceHigh: canon.refHigh,
              flag:
                l.flag?.value ??
                computeFlag(l.value?.value ?? null, canon.refLow, canon.refHigh),
              measuredAt: l.measuredAt?.value ?? docDate,
              confidence: Math.min(l.analyte.confidence, l.value?.confidence ?? 1),
              verification,
              createdAt: now,
            },
          ];
        }),
        vitals: extraction.vitals.flatMap((v) =>
          v.kind.value
            ? [
                {
                  id: newId(),
                  userId: req.userId,
                  documentId: doc.id,
                  kind: v.kind.value,
                  value: v.value?.value ?? null,
                  valueSecondary: v.valueSecondary?.value ?? null,
                  unit: v.unit?.value ?? null,
                  measuredAt: v.measuredAt?.value ?? docDate,
                  confidence: v.kind.confidence,
                  verification,
                  createdAt: now,
                },
              ]
            : []
        ),
        allergies: extraction.allergies.flatMap((a) =>
          a.substance.value
            ? [
                {
                  id: newId(),
                  userId: req.userId,
                  documentId: doc.id,
                  substance: a.substance.value,
                  reaction: a.reaction?.value ?? null,
                  severity: a.severity?.value ?? null,
                  confidence: a.substance.confidence,
                  verification,
                  createdAt: now,
                },
              ]
            : []
        ),
      });

      doc.status = stats.needsReview ? "needs_review" : "processed";
      job.status = "succeeded";
      job.finishedAt = nowIso();
      await this.store.putJob(job);
      await this.store.putDocument(doc);
      await this.store.audit(req.userId, {
        action: "ingest_document",
        entity: "document",
        entityId: doc.id,
        meta: {
          tier: doc.ocrTier,
          kind: doc.kind,
          meanConfidence: job.meanConfidence,
          needsReview: stats.needsReview,
        },
      });

      return { document: doc, tier: doc.ocrTier, needsReview: stats.needsReview };
    } catch (err) {
      doc.status = "failed";
      job.status = "failed";
      job.error = err instanceof Error ? err.message : String(err);
      job.finishedAt = nowIso();
      await this.store.putJob(job);
      await this.store.putDocument(doc);
      return { document: doc, tier: doc.ocrTier, needsReview: false, error: job.error };
    }
  }
}
