import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DEFAULT_RETENTION_POLICY,
  displayPreferencesSchema,
  retentionPolicySchema,
  type AllergyRecord,
  type ConditionRecord,
  type DisplayPreferences,
  type DocumentRecord,
  type LabResultRecord,
  type MedicationRecord,
  type ReportSpec,
  type RetentionPolicy,
  type UserProfile,
  type VitalRecord,
} from "@vitalis/shared";
import type {
  AuditEvent,
  ExtractionJob,
  FactCollections,
  FactPatch,
  Store,
} from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Supabase-backed store. The schema lives in supabase/migrations/0001_init.sql.
 *
 * The server connects with the SERVICE ROLE key because pipeline writes happen
 * without a user JWT in the loop; every query is still explicitly scoped by
 * user_id, and RLS remains as defense-in-depth for direct client access.
 */
export class SupabaseStore implements Store {
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

  private async run<T>(q: PromiseLike<{ data: T | null; error: any }>): Promise<T | null> {
    const { data, error } = await q;
    if (error) throw new Error(`supabase: ${error.message}`);
    return data;
  }

  // ------------------------------------------------------------- profile ---

  async getProfile(userId: string): Promise<UserProfile> {
    const row = await this.run(
      this.db.from("profiles").select("*").eq("user_id", userId).maybeSingle()
    );
    if (!row) {
      const profile: UserProfile = {
        userId,
        displayName: "Vitalis User",
        dob: null,
        sex: null,
        heightCm: null,
        weightKg: null,
        updatedAt: new Date().toISOString(),
      };
      await this.saveProfile(profile);
      return profile;
    }
    const r = row as any;
    return {
      userId: r.user_id,
      displayName: r.display_name,
      dob: r.dob,
      sex: r.sex,
      heightCm: r.height_cm === null ? null : Number(r.height_cm),
      weightKg: r.weight_kg === null ? null : Number(r.weight_kg),
      updatedAt: r.updated_at,
    };
  }

  async saveProfile(p: UserProfile): Promise<void> {
    await this.run(
      this.db.from("profiles").upsert({
        user_id: p.userId,
        display_name: p.displayName,
        dob: p.dob,
        sex: p.sex,
        height_cm: p.heightCm,
        weight_kg: p.weightKg,
        updated_at: new Date().toISOString(),
      })
    );
  }

  async getPreferences(userId: string): Promise<DisplayPreferences> {
    const row = await this.run(
      this.db.from("profiles").select("preferences").eq("user_id", userId).maybeSingle()
    );
    const raw = (row as any)?.preferences ?? {};
    return { ...DEFAULT_DISPLAY_PREFERENCES, ...displayPreferencesSchema.partial().parse(raw) };
  }

  async savePreferences(userId: string, prefs: DisplayPreferences): Promise<void> {
    await this.run(
      this.db.from("profiles").upsert({ user_id: userId, preferences: prefs })
    );
  }

  async getRetention(userId: string): Promise<RetentionPolicy> {
    const row = await this.run(
      this.db.from("profiles").select("retention").eq("user_id", userId).maybeSingle()
    );
    const raw = (row as any)?.retention ?? {};
    return { ...DEFAULT_RETENTION_POLICY, ...retentionPolicySchema.partial().parse(raw) };
  }

  async saveRetention(userId: string, policy: RetentionPolicy): Promise<void> {
    await this.run(this.db.from("profiles").upsert({ user_id: userId, retention: policy }));
  }

  // ------------------------------------------------------------ documents ---

  async putDocument(d: DocumentRecord): Promise<void> {
    await this.run(
      this.db.from("documents").upsert({
        id: d.id,
        user_id: d.userId,
        kind: d.kind,
        title: d.title,
        mime_type: d.mimeType,
        storage_path: d.storagePath,
        content_hash: d.contentHash,
        recorded_at: d.recordedAt,
        status: d.status,
        raw_text: d.rawText,
        ocr_tier: d.ocrTier,
        created_at: d.createdAt,
      })
    );
  }

  private docFromRow(r: any): DocumentRecord {
    return {
      id: r.id,
      userId: r.user_id,
      kind: r.kind,
      title: r.title,
      mimeType: r.mime_type,
      storagePath: r.storage_path,
      contentHash: r.content_hash,
      recordedAt: r.recorded_at,
      status: r.status,
      rawText: r.raw_text,
      ocrTier: r.ocr_tier,
      createdAt: r.created_at,
    };
  }

  async getDocument(userId: string, id: string): Promise<DocumentRecord | null> {
    const r = await this.run(
      this.db.from("documents").select("*").eq("user_id", userId).eq("id", id).maybeSingle()
    );
    return r ? this.docFromRow(r) : null;
  }

  async listDocuments(userId: string): Promise<DocumentRecord[]> {
    const rows = await this.run(
      this.db.from("documents").select("*").eq("user_id", userId).order("created_at", { ascending: false })
    );
    return (rows as any[] | null ?? []).map((r) => this.docFromRow(r));
  }

  async deleteDocument(userId: string, id: string): Promise<boolean> {
    const rows = await this.run(
      this.db.from("documents").delete().eq("user_id", userId).eq("id", id).select("id")
    );
    return ((rows as any[] | null) ?? []).length > 0;
    // facts delete via ON DELETE CASCADE on document_id
  }

  async findByHash(userId: string, contentHash: string): Promise<DocumentRecord | null> {
    const r = await this.run(
      this.db.from("documents").select("*").eq("user_id", userId).eq("content_hash", contentHash).maybeSingle()
    );
    return r ? this.docFromRow(r) : null;
  }

  // ----------------------------------------------------------------- jobs ---

  async putJob(j: ExtractionJob): Promise<void> {
    await this.run(
      this.db.from("extraction_jobs").upsert({
        id: j.id,
        document_id: j.documentId,
        user_id: j.userId,
        ocr_tier: j.ocrTier,
        model: j.model,
        status: j.status,
        mean_confidence: j.meanConfidence,
        fields_total: j.fieldsTotal,
        fields_below_threshold: j.fieldsBelowThreshold,
        error: j.error,
        finished_at: j.finishedAt,
      })
    );
  }

  async listJobsForDocument(userId: string, documentId: string): Promise<ExtractionJob[]> {
    const rows = await this.run(
      this.db.from("extraction_jobs").select("*").eq("user_id", userId).eq("document_id", documentId)
    );
    return ((rows as any[] | null) ?? []).map((r) => ({
      id: r.id,
      documentId: r.document_id,
      userId: r.user_id,
      ocrTier: r.ocr_tier,
      model: r.model,
      status: r.status,
      meanConfidence: r.mean_confidence === null ? null : Number(r.mean_confidence),
      fieldsTotal: r.fields_total ?? 0,
      fieldsBelowThreshold: r.fields_below_threshold ?? 0,
      error: r.error,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    }));
  }

  // ----------------------------------------------------------------- facts ---

  async addFacts(userId: string, f: FactPatch): Promise<void> {
    if (f.medications?.length) {
      await this.run(
        this.db.from("medications").insert(
          f.medications.map((m) => ({
            id: m.id,
            user_id: userId,
            document_id: m.documentId,
            drug_name: m.drugName,
            dose_amount: m.dose?.amount ?? null,
            dose_unit: m.dose?.unit ?? null,
            frequency: m.frequency,
            route: m.route,
            prescriber: m.prescriber,
            start_date: m.startDate,
            end_date: m.endDate,
            instructions: m.instructions,
            status: m.status,
            confidence: m.confidence,
            verification: m.verification,
            created_at: m.createdAt,
          }))
        )
      );
    }
    if (f.conditions?.length) {
      await this.run(
        this.db.from("conditions").insert(
          f.conditions.map((c) => ({
            id: c.id,
            user_id: userId,
            document_id: c.documentId,
            name: c.name,
            icd10: c.icd10,
            status: c.status,
            diagnosed_at: c.diagnosedAt,
            confidence: c.confidence,
            verification: c.verification,
            created_at: c.createdAt,
          }))
        )
      );
    }
    if (f.labResults?.length) {
      await this.run(
        this.db.from("lab_results").insert(
          f.labResults.map((l) => ({
            id: l.id,
            user_id: userId,
            document_id: l.documentId,
            analyte: l.analyte,
            display_name: l.displayName,
            value: l.value,
            unit: l.unit,
            ref_low: l.referenceLow,
            ref_high: l.referenceHigh,
            flag: l.flag,
            measured_at: l.measuredAt,
            confidence: l.confidence,
            verification: l.verification,
            created_at: l.createdAt,
          }))
        )
      );
    }
    if (f.vitals?.length) {
      await this.run(
        this.db.from("vitals").insert(
          f.vitals.map((v) => ({
            id: v.id,
            user_id: userId,
            document_id: v.documentId,
            kind: v.kind,
            value: v.value,
            value_secondary: v.valueSecondary,
            unit: v.unit,
            measured_at: v.measuredAt,
            confidence: v.confidence,
            verification: v.verification,
            created_at: v.createdAt,
          }))
        )
      );
    }
    if (f.allergies?.length) {
      await this.run(
        this.db.from("allergies").insert(
          f.allergies.map((a) => ({
            id: a.id,
            user_id: userId,
            document_id: a.documentId,
            substance: a.substance,
            reaction: a.reaction,
            severity: a.severity,
            confidence: a.confidence,
            verification: a.verification,
            created_at: a.createdAt,
          }))
        )
      );
    }
  }

  async getFacts(userId: string): Promise<FactCollections> {
    const [meds, conds, labs, vitals, allergies] = await Promise.all([
      this.run(this.db.from("medications").select("*").eq("user_id", userId)),
      this.run(this.db.from("conditions").select("*").eq("user_id", userId)),
      this.run(this.db.from("lab_results").select("*").eq("user_id", userId)),
      this.run(this.db.from("vitals").select("*").eq("user_id", userId)),
      this.run(this.db.from("allergies").select("*").eq("user_id", userId)),
    ]);

    return {
      medications: ((meds as any[] | null) ?? []).map(
        (r): MedicationRecord => ({
          id: r.id,
          userId: r.user_id,
          documentId: r.document_id,
          drugName: r.drug_name,
          dose: r.dose_amount === null ? null : { amount: Number(r.dose_amount), unit: r.dose_unit },
          frequency: r.frequency,
          route: r.route,
          prescriber: r.prescriber,
          startDate: r.start_date,
          endDate: r.end_date,
          instructions: r.instructions,
          status: r.status,
          confidence: Number(r.confidence),
          verification: r.verification,
          createdAt: r.created_at,
        })
      ),
      conditions: ((conds as any[] | null) ?? []).map(
        (r): ConditionRecord => ({
          id: r.id,
          userId: r.user_id,
          documentId: r.document_id,
          name: r.name,
          icd10: r.icd10,
          status: r.status,
          diagnosedAt: r.diagnosed_at,
          confidence: Number(r.confidence),
          verification: r.verification,
          createdAt: r.created_at,
        })
      ),
      labResults: ((labs as any[] | null) ?? []).map(
        (r): LabResultRecord => ({
          id: r.id,
          userId: r.user_id,
          documentId: r.document_id,
          analyte: r.analyte,
          displayName: r.display_name,
          value: r.value === null ? null : Number(r.value),
          unit: r.unit,
          referenceLow: r.ref_low === null ? null : Number(r.ref_low),
          referenceHigh: r.ref_high === null ? null : Number(r.ref_high),
          flag: r.flag,
          measuredAt: r.measured_at,
          confidence: Number(r.confidence),
          verification: r.verification,
          createdAt: r.created_at,
        })
      ),
      vitals: ((vitals as any[] | null) ?? []).map(
        (r): VitalRecord => ({
          id: r.id,
          userId: r.user_id,
          documentId: r.document_id,
          kind: r.kind,
          value: r.value === null ? null : Number(r.value),
          valueSecondary: r.value_secondary === null ? null : Number(r.value_secondary),
          unit: r.unit,
          measuredAt: r.measured_at,
          confidence: Number(r.confidence),
          verification: r.verification,
          createdAt: r.created_at,
        })
      ),
      allergies: ((allergies as any[] | null) ?? []).map(
        (r): AllergyRecord => ({
          id: r.id,
          userId: r.user_id,
          documentId: r.document_id,
          substance: r.substance,
          reaction: r.reaction,
          severity: r.severity,
          confidence: Number(r.confidence),
          verification: r.verification,
          createdAt: r.created_at,
        })
      ),
    };
  }

  async deleteFactsForDocument(userId: string, documentId: string): Promise<void> {
    for (const table of ["medications", "conditions", "lab_results", "vitals", "allergies"]) {
      await this.run(
        this.db.from(table).delete().eq("user_id", userId).eq("document_id", documentId)
      );
    }
  }

  async markFactVerified(
    userId: string,
    collection: keyof FactCollections,
    factId: string
  ): Promise<boolean> {
    const table =
      collection === "labResults"
        ? "lab_results"
        : collection === "medications"
          ? "medications"
          : collection === "conditions"
            ? "conditions"
            : collection === "vitals"
              ? "vitals"
              : "allergies";
    const rows = await this.run(
      this.db
        .from(table)
        .update({ verification: "human_verified" })
        .eq("user_id", userId)
        .eq("id", factId)
        .select("id")
    );
    return ((rows as any[] | null) ?? []).length > 0;
  }

  // --------------------------------------------------------------- reports ---

  async putReport(userId: string, spec: ReportSpec): Promise<void> {
    await this.run(
      this.db.from("report_specs").insert({ id: spec.id, user_id: userId, spec })
    );
  }

  async getReport(userId: string, id: string): Promise<ReportSpec | null> {
    const r = await this.run(
      this.db.from("report_specs").select("spec").eq("user_id", userId).eq("id", id).maybeSingle()
    );
    return (r as any)?.spec ?? null;
  }

  async listReports(userId: string): Promise<Array<{ id: string; generatedAt: string }>> {
    const rows = await this.run(
      this.db
        .from("report_specs")
        .select("id, created_at, spec")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
    );
    return ((rows as any[] | null) ?? []).map((r) => ({
      id: r.id,
      generatedAt: r.spec?.generatedAt ?? r.created_at,
    }));
  }

  // ----------------------------------------------------------------- audit ---

  async audit(userId: string, event: AuditEvent): Promise<void> {
    await this.run(
      this.db.from("audit_log").insert({
        user_id: userId,
        action: event.action,
        entity: event.entity,
        entity_id: event.entityId,
        meta: event.meta ?? {},
      })
    );
  }

  async listAudit(userId: string): Promise<AuditEvent[]> {
    const rows = await this.run(
      this.db.from("audit_log").select("*").eq("user_id", userId).order("created_at", { ascending: false })
    );
    return ((rows as any[] | null) ?? []).map((r) => ({
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      meta: r.meta,
    }));
  }

  // ------------------------------------------------------------- lifecycle ---

  async deleteEverything(userId: string): Promise<void> {
    // FK cascades handle documents -> jobs/facts; delete remaining roots.
    for (const table of ["report_specs", "audit_log", "documents", "profiles"]) {
      await this.run(this.db.from(table).delete().eq("user_id", userId));
    }
  }

  async countUsers(): Promise<number> {
    const { count, error } = await this.db
      .from("profiles")
      .select("user_id", { count: "exact", head: true });
    if (error) throw new Error(`supabase: ${error.message}`);
    return count ?? 0;
  }
}
