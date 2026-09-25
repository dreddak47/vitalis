import type {
  DisplayPreferences,
  DocumentRecord,
  HealthRecords,
  ReportSpec,
  RetentionPolicy,
  UserProfile,
} from "@vitalis/shared";

/**
 * Demo single-user slice. In the Auth-integrated deployment the JWT resolves
 * the user server-side and this constant disappears.
 */
export const USER_ID = "demo";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only set the JSON content-type when there is a body — Fastify rejects
  // empty-body requests that carry `content-type: application/json`
  // (FST_ERR_CTP_EMPTY_JSON_BODY), which broke Confirm / Generate report.
  const headers = init?.body ? { "content-type": "application/json" } : undefined;
  const res = await fetch(path, { headers, ...init });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const base = `/api/users/${USER_ID}`;

export const api = {
  getProfile: () => req<UserProfile>(`${base}/profile`),
  saveProfile: (p: Partial<UserProfile>) =>
    req<UserProfile>(`${base}/profile`, { method: "PUT", body: JSON.stringify(p) }),

  getPreferences: () => req<DisplayPreferences>(`${base}/preferences`),
  savePreferences: (p: DisplayPreferences) =>
    req<DisplayPreferences>(`${base}/preferences`, { method: "PUT", body: JSON.stringify(p) }),

  getRetention: () => req<RetentionPolicy>(`${base}/retention`),
  saveRetention: (p: RetentionPolicy) =>
    req<RetentionPolicy>(`${base}/retention`, { method: "PUT", body: JSON.stringify(p) }),

  listDocuments: () => req<DocumentRecord[]>(`${base}/documents`),
  documentDetail: (id: string) =>
    req<{ document: DocumentRecord; facts: Partial<HealthRecords> }>(`${base}/documents/${id}`),
  uploadDocument: (body: {
    title: string;
    mimeType: string;
    contentBase64: string;
    recordedAt?: string | null;
    looksHandwritten?: boolean;
    embeddedText?: string | null;
  }) =>
    req<{ document: DocumentRecord; needsReview: boolean; error?: string }>(`${base}/documents`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteDocument: (id: string) => req<void>(`${base}/documents/${id}`, { method: "DELETE" }),

  getRecords: () => req<HealthRecords>(`${base}/records`),
  verifyFact: (collection: keyof HealthRecords, factId: string) =>
    req<{ verified: boolean }>(`${base}/records/${collection}/${factId}/verify`, {
      method: "POST",
    }),

  generateReport: () => req<ReportSpec>(`${base}/reports`, { method: "POST" }),
  listReports: () => req<Array<{ id: string; generatedAt: string }>>(`${base}/reports`),
  getReport: (id: string) => req<ReportSpec>(`${base}/reports/${id}`),
  downloadUrl: (id: string) => `${base}/reports/${id}/html`,
  exportUrl: () => `${base}/export`,

  deleteEverything: () => req<void>(`${base}`, { method: "DELETE" }),
};
