import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  displayPreferencesSchema,
  retentionPolicySchema,
  type DocumentKind,
  DOCUMENT_KINDS,
} from "@vitalis/shared";
import type { IngestionService } from "../pipeline/ingest.js";
import { compileReport } from "../report/compiler.js";
import { renderReportHtml } from "../report/render.js";
import type { Store } from "../store/index.js";
import type { FactCollections } from "../store/types.js";
import { nowIso } from "../util/helpers.js";

export interface ApiDeps {
  store: Store;
  ingestion: IngestionService;
}

const notFound = (reply: FastifyReply, what: string) =>
  reply.code(404).send({ error: `${what} not found` });

export function registerRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { store, ingestion } = deps;

  /* Single-user slice: routes take :userId explicitly. Behind Supabase Auth,
     the gateway maps the JWT sub onto this param — see docs/ARCHITECTURE.md. */

  // ------------------------------------------------------------ profile ---

  app.get("/api/users/:userId/profile", async (req) => {
    const { userId } = req.params as { userId: string };
    return store.getProfile(userId);
  });

  app.put("/api/users/:userId/profile", async (req) => {
    const { userId } = req.params as { userId: string };
    const body = z
      .object({
        displayName: z.string().optional(),
        dob: z.string().nullable().optional(),
        sex: z.enum(["female", "male", "intersex", "unknown"]).nullable().optional(),
        heightCm: z.number().nullable().optional(),
        weightKg: z.number().nullable().optional(),
      })
      .parse(req.body);
    const current = await store.getProfile(userId);
    const next = { ...current, ...body, updatedAt: nowIso() };
    await store.saveProfile(next);
    return next;
  });

  app.get("/api/users/:userId/preferences", async (req) => {
    const { userId } = req.params as { userId: string };
    return store.getPreferences(userId);
  });

  app.put("/api/users/:userId/preferences", async (req) => {
    const { userId } = req.params as { userId: string };
    const prefs = displayPreferencesSchema.parse(req.body);
    await store.savePreferences(userId, prefs);
    return prefs;
  });

  app.get("/api/users/:userId/retention", async (req) => {
    const { userId } = req.params as { userId: string };
    return store.getRetention(userId);
  });

  app.put("/api/users/:userId/retention", async (req) => {
    const { userId } = req.params as { userId: string };
    const policy = retentionPolicySchema.parse(req.body);
    await store.saveRetention(userId, policy);
    await store.audit(userId, {
      action: "update_retention_policy",
      entity: "profile",
      entityId: userId,
      meta: policy as Record<string, unknown>,
    });
    return policy;
  });

  // ---------------------------------------------------------- documents ---

  const uploadSchema = z.object({
    title: z.string().min(1),
    mimeType: z.string().min(1),
    /** Base64-encoded file bytes (JSON transport keeps the API simple). */
    contentBase64: z.string().min(1),
    recordedAt: z.string().nullable().optional(),
    kind: z.enum(DOCUMENT_KINDS).optional(),
    looksHandwritten: z.boolean().optional(),
    embeddedText: z.string().nullable().optional(),
  });

  app.post("/api/users/:userId/documents", async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const body = uploadSchema.parse(req.body);
    const outcome = await ingestion.ingest({
      userId,
      title: body.title,
      mimeType: body.mimeType,
      bytes: Buffer.from(body.contentBase64, "base64"),
      recordedAt: body.recordedAt ?? null,
      kindHint: body.kind,
      looksHandwritten: body.looksHandwritten,
      embeddedText: body.embeddedText,
    });
    reply.code(outcome.error ? 422 : 201);
    return outcome;
  });

  app.get("/api/users/:userId/documents", async (req) => {
    const { userId } = req.params as { userId: string };
    return store.listDocuments(userId);
  });

  app.get("/api/users/:userId/documents/:id", async (req, reply) => {
    const { userId, id } = req.params as { userId: string; id: string };
    const doc = await store.getDocument(userId, id);
    if (!doc) return notFound(reply, "document");
    const jobs = await store.listJobsForDocument(userId, id);
    const facts = await store.getFacts(userId);
    const forDoc = {
      medications: facts.medications.filter((f) => f.documentId === id),
      conditions: facts.conditions.filter((f) => f.documentId === id),
      labResults: facts.labResults.filter((f) => f.documentId === id),
      vitals: facts.vitals.filter((f) => f.documentId === id),
      allergies: facts.allergies.filter((f) => f.documentId === id),
    };
    return { document: doc, jobs, facts: forDoc };
  });

  app.delete("/api/users/:userId/documents/:id", async (req, reply) => {
    const { userId, id } = req.params as { userId: string; id: string };
    const deleted = await store.deleteDocument(userId, id);
    if (!deleted) return notFound(reply, "document");
    await store.audit(userId, { action: "delete_document", entity: "document", entityId: id });
    reply.code(204);
    return null;
  });

  // -------------------------------------------------------------- records ---

  app.get("/api/users/:userId/records", async (req) => {
    const { userId } = req.params as { userId: string };
    const facts = await store.getFacts(userId);
    return {
      medications: facts.medications,
      conditions: facts.conditions,
      labResults: facts.labResults,
      vitals: facts.vitals,
      allergies: facts.allergies,
    };
  });

  app.post("/api/users/:userId/records/:collection/:factId/verify", async (req, reply) => {
    const { userId, collection, factId } = req.params as {
      userId: string;
      collection: keyof FactCollections;
      factId: string;
    };
    const ok = await store.markFactVerified(userId, collection, factId);
    if (!ok) return notFound(reply, "fact");
    await store.audit(userId, {
      action: "verify_fact",
      entity: String(collection),
      entityId: factId,
    });

    // A document graduates to "processed" when nothing under it remains unverified.
    const facts = await store.getFacts(userId);
    const docs = await store.listDocuments(userId);
    for (const doc of docs.filter((d) => d.status === "needs_review")) {
      const all = [
        ...facts.medications,
        ...facts.conditions,
        ...facts.labResults,
        ...facts.vitals,
        ...facts.allergies,
      ].filter((f) => f.documentId === doc.id);
      if (all.length > 0 && all.every((f) => f.verification !== "unverified")) {
        await store.putDocument({ ...doc, status: "processed" });
      }
    }
    return { verified: true };
  });

  // -------------------------------------------------------------- reports ---

  app.post("/api/users/:userId/reports", async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const [profile, preferences, facts, documents] = await Promise.all([
      store.getProfile(userId),
      store.getPreferences(userId),
      store.getFacts(userId),
      store.listDocuments(userId),
    ]);
    const spec = compileReport(userId, profile, preferences, facts, documents);
    await store.putReport(userId, spec);
    await store.audit(userId, {
      action: "generate_report",
      entity: "report",
      entityId: spec.id,
      meta: { sections: spec.sections.map((s) => s.kind) },
    });
    reply.code(201);
    return spec;
  });

  app.get("/api/users/:userId/reports", async (req) => {
    const { userId } = req.params as { userId: string };
    return store.listReports(userId);
  });

  app.get("/api/users/:userId/reports/:id", async (req, reply) => {
    const { userId, id } = req.params as { userId: string; id: string };
    const spec = await store.getReport(userId, id);
    if (!spec) return notFound(reply, "report");
    return spec;
  });

  /** Downloadable, printable, self-contained HTML compiled on the server. */
  app.get("/api/users/:userId/reports/:id/html", async (req, reply) => {
    const { userId, id } = req.params as { userId: string; id: string };
    const spec = await store.getReport(userId, id);
    if (!spec) return notFound(reply, "report");
    reply
      .header("content-type", "text/html; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="vitalis-report-${spec.generatedAt.slice(0, 10)}.html"`
      );
    return renderReportHtml(spec);
  });

  // --------------------------------------------------------------- export ---

  /** One-click export: every document, fact, report and setting in one JSON. */
  app.get("/api/users/:userId/export", async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const [profile, preferences, retention, documents, facts, reports] = await Promise.all([
      store.getProfile(userId),
      store.getPreferences(userId),
      store.getRetention(userId),
      store.listDocuments(userId),
      store.getFacts(userId),
      store.listReports(userId),
    ]);
    await store.audit(userId, { action: "export_all", entity: "user", entityId: userId });
    reply
      .header(
        "content-disposition",
        `attachment; filename="vitalis-export-${nowIso().slice(0, 10)}.json"`
      )
      .header("content-type", "application/json");
    return {
      format: "vitalis-export/v1",
      exportedAt: nowIso(),
      profile,
      preferences,
      retention,
      documents,
      records: facts,
      reports: reports.map((r) => r.id),
    };
  });

  app.delete("/api/users/:userId", async (req, reply) => {
    const { userId } = req.params as { userId: string };
    await store.audit(userId, { action: "delete_everything", entity: "user", entityId: userId });
    await store.deleteEverything(userId);
    reply.code(204);
    return null;
  });

  app.get("/api/health", async () => ({ ok: true, service: "vitalis" }));
}
