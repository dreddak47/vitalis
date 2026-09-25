import type {
  AllergyRecord,
  ConditionRecord,
  DisplayPreferences,
  DocumentRecord,
  LabResultRecord,
  MedicationRecord,
  ReportSpec,
  RetentionPolicy,
  UserProfile,
  VitalRecord,
} from "@vitalis/shared";

export interface ExtractionJob {
  id: string;
  documentId: string;
  userId: string;
  ocrTier: string | null;
  model: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  meanConfidence: number | null;
  fieldsTotal: number;
  fieldsBelowThreshold: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface AuditEvent {
  action: string;
  entity: string;
  entityId: string;
  meta?: Record<string, unknown>;
}

export interface FactPatch {
  medications?: MedicationRecord[];
  conditions?: ConditionRecord[];
  labResults?: LabResultRecord[];
  vitals?: VitalRecord[];
  allergies?: AllergyRecord[];
}

export interface FactCollections {
  medications: MedicationRecord[];
  conditions: ConditionRecord[];
  labResults: LabResultRecord[];
  vitals: VitalRecord[];
  allergies: AllergyRecord[];
}

/**
 * Persistence boundary. Everything above this interface is storage-agnostic:
 * swapping Supabase in (STORE_BACKEND=supabase) changes no pipeline code.
 */
export interface Store {
  // profile / preferences / retention
  getProfile(userId: string): Promise<UserProfile>;
  saveProfile(profile: UserProfile): Promise<void>;
  getPreferences(userId: string): Promise<DisplayPreferences>;
  savePreferences(userId: string, prefs: DisplayPreferences): Promise<void>;
  getRetention(userId: string): Promise<RetentionPolicy>;
  saveRetention(userId: string, policy: RetentionPolicy): Promise<void>;

  // documents
  putDocument(doc: DocumentRecord): Promise<void>;
  getDocument(userId: string, id: string): Promise<DocumentRecord | null>;
  listDocuments(userId: string): Promise<DocumentRecord[]>;
  deleteDocument(userId: string, id: string): Promise<boolean>;
  findByHash(userId: string, contentHash: string): Promise<DocumentRecord | null>;

  // extraction jobs (audit of pipeline runs)
  putJob(job: ExtractionJob): Promise<void>;
  listJobsForDocument(userId: string, documentId: string): Promise<ExtractionJob[]>;

  // facts
  addFacts(userId: string, facts: FactPatch): Promise<void>;
  getFacts(userId: string): Promise<FactCollections>;
  deleteFactsForDocument(userId: string, documentId: string): Promise<void>;
  markFactVerified(
    userId: string,
    collection: keyof FactCollections,
    factId: string
  ): Promise<boolean>;

  // reports
  putReport(userId: string, spec: ReportSpec): Promise<void>;
  getReport(userId: string, id: string): Promise<ReportSpec | null>;
  listReports(userId: string): Promise<Array<{ id: string; generatedAt: string }>>;

  // audit
  audit(userId: string, event: AuditEvent): Promise<void>;
  listAudit(userId: string): Promise<AuditEvent[]>;

  // lifecycle
  deleteEverything(userId: string): Promise<void>;
  countUsers(): Promise<number>;
}
