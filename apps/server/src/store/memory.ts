import {
  DEFAULT_DISPLAY_PREFERENCES,
  DEFAULT_RETENTION_POLICY,
  displayPreferencesSchema,
  retentionPolicySchema,
  type DisplayPreferences,
  type DocumentRecord,
  type ReportSpec,
  type RetentionPolicy,
  type UserProfile,
} from "@vitalis/shared";
import type {
  AuditEvent,
  ExtractionJob,
  FactCollections,
  FactPatch,
  Store,
} from "./types.js";

interface UserBucket {
  profile: UserProfile;
  preferences: DisplayPreferences;
  retention: RetentionPolicy;
  documents: Map<string, DocumentRecord>;
  jobs: Map<string, ExtractionJob>;
  facts: FactCollections;
  reports: Map<string, ReportSpec>;
  audit: Array<AuditEvent & { at: string }>;
}

const emptyFacts = (): FactCollections => ({
  medications: [],
  conditions: [],
  labResults: [],
  vitals: [],
  allergies: [],
});

/**
 * Default store: pure in-memory, zero external services. Perfect for demos,
 * tests and the eval harness. Data is lost on restart — use the Supabase
 * store for anything real.
 */
export class MemoryStore implements Store {
  private users = new Map<string, UserBucket>();

  private bucket(userId: string): UserBucket {
    let b = this.users.get(userId);
    if (!b) {
      b = {
        profile: {
          userId,
          displayName: "Vitalis User",
          dob: null,
          sex: null,
          heightCm: null,
          weightKg: null,
          updatedAt: new Date().toISOString(),
        },
        preferences: DEFAULT_DISPLAY_PREFERENCES,
        retention: DEFAULT_RETENTION_POLICY,
        documents: new Map(),
        jobs: new Map(),
        facts: emptyFacts(),
        reports: new Map(),
        audit: [],
      };
      this.users.set(userId, b);
    }
    return b;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    return this.bucket(userId).profile;
  }

  async saveProfile(profile: UserProfile): Promise<void> {
    this.bucket(profile.userId).profile = {
      ...profile,
      updatedAt: new Date().toISOString(),
    };
  }

  async getPreferences(userId: string): Promise<DisplayPreferences> {
    return this.bucket(userId).preferences;
  }

  async savePreferences(userId: string, prefs: DisplayPreferences): Promise<void> {
    this.bucket(userId).preferences = displayPreferencesSchema.parse(prefs);
  }

  async getRetention(userId: string): Promise<RetentionPolicy> {
    return this.bucket(userId).retention;
  }

  async saveRetention(userId: string, policy: RetentionPolicy): Promise<void> {
    this.bucket(userId).retention = retentionPolicySchema.parse(policy);
  }

  async putDocument(doc: DocumentRecord): Promise<void> {
    this.bucket(doc.userId).documents.set(doc.id, doc);
  }

  async getDocument(userId: string, id: string): Promise<DocumentRecord | null> {
    return this.bucket(userId).documents.get(id) ?? null;
  }

  async listDocuments(userId: string): Promise<DocumentRecord[]> {
    return [...this.bucket(userId).documents.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  async deleteDocument(userId: string, id: string): Promise<boolean> {
    const b = this.bucket(userId);
    const existed = b.documents.delete(id);
    if (existed) await this.deleteFactsForDocument(userId, id);
    return existed;
  }

  async findByHash(userId: string, contentHash: string): Promise<DocumentRecord | null> {
    for (const d of this.bucket(userId).documents.values()) {
      if (d.contentHash === contentHash) return d;
    }
    return null;
  }

  async putJob(job: ExtractionJob): Promise<void> {
    this.bucket(job.userId).jobs.set(job.id, job);
  }

  async listJobsForDocument(userId: string, documentId: string): Promise<ExtractionJob[]> {
    return [...this.bucket(userId).jobs.values()].filter(
      (j) => j.documentId === documentId
    );
  }

  async addFacts(userId: string, patch: FactPatch): Promise<void> {
    const f = this.bucket(userId).facts;
    if (patch.medications) f.medications.push(...patch.medications);
    if (patch.conditions) f.conditions.push(...patch.conditions);
    if (patch.labResults) f.labResults.push(...patch.labResults);
    if (patch.vitals) f.vitals.push(...patch.vitals);
    if (patch.allergies) f.allergies.push(...patch.allergies);
  }

  async getFacts(userId: string): Promise<FactCollections> {
    return this.bucket(userId).facts;
  }

  async deleteFactsForDocument(userId: string, documentId: string): Promise<void> {
    const f = this.bucket(userId).facts;
    const keep = <T extends { documentId: string }>(arr: T[]) =>
      arr.filter((x) => x.documentId !== documentId);
    f.medications = keep(f.medications);
    f.conditions = keep(f.conditions);
    f.labResults = keep(f.labResults);
    f.vitals = keep(f.vitals);
    f.allergies = keep(f.allergies);
  }

  async markFactVerified(
    userId: string,
    collection: keyof FactCollections,
    factId: string
  ): Promise<boolean> {
    const list = this.bucket(userId).facts[collection] as Array<{
      id: string;
      verification: string;
    }>;
    const item = list.find((x) => x.id === factId);
    if (!item) return false;
    item.verification = "human_verified";
    return true;
  }

  async putReport(userId: string, spec: ReportSpec): Promise<void> {
    this.bucket(userId).reports.set(spec.id, spec);
  }

  async getReport(userId: string, id: string): Promise<ReportSpec | null> {
    return this.bucket(userId).reports.get(id) ?? null;
  }

  async listReports(userId: string): Promise<Array<{ id: string; generatedAt: string }>> {
    return [...this.bucket(userId).reports.values()]
      .map((r) => ({ id: r.id, generatedAt: r.generatedAt }))
      .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  }

  async audit(userId: string, event: AuditEvent): Promise<void> {
    this.bucket(userId).audit.push({ ...event, at: new Date().toISOString() });
  }

  async listAudit(userId: string): Promise<AuditEvent[]> {
    return this.bucket(userId).audit;
  }

  async deleteEverything(userId: string): Promise<void> {
    this.users.delete(userId);
  }

  async countUsers(): Promise<number> {
    return this.users.size;
  }
}
