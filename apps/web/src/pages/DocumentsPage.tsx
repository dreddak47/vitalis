import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentRecord } from "@vitalis/shared";
import { api } from "../api";

export function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handwritten, setHandwritten] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setDocs(await api.listDocuments());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const contentBase64 = btoa(binary);

      const isTextual = file.type.startsWith("text/") || file.type === "application/pdf";
      const outcome = await api.uploadDocument({
        title: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
        looksHandwritten: handwritten,
        // In production the client extracts PDF text locally via pdf.js;
        // here we pass plain text through and let the server tier-1 it.
        embeddedText: file.type.startsWith("text/") ? await file.text() : null,
      });
      if (outcome.error) setError(outcome.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <div className="page-head"><h1>Documents</h1></div>

      <div className="card">
        <h2>Upload</h2>
        <p className="legend">
          Files go through the tiered pipeline: text layer → classical OCR → vision model,
          then a domain-aware extraction agent, then your review for low-confidence fields.
        </p>
        <div className="btn-row" style={{ alignItems: "center" }}>
          <input ref={fileRef} type="file" accept=".txt,.pdf,image/*,.md" />
          <label className="checkbox-row">
            <input type="checkbox" checked={handwritten} onChange={(e) => setHandwritten(e.target.checked)} />
            handwritten (skips classical OCR)
          </label>
          <button className="primary" onClick={() => void upload()} disabled={busy}>
            {busy ? "Processing…" : "Upload & extract"}
          </button>
        </div>
        {error && <div className="error-box" style={{ marginTop: "0.75rem" }}>{error}</div>}
      </div>

      <div className="card">
        <h2>Your documents ({docs.length})</h2>
        {docs.length === 0 ? (
          <p className="empty">Nothing uploaded yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Title</th><th>Kind</th><th>OCR tier</th><th>Status</th><th>Recorded</th><th></th></tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.title}</td>
                  <td>{d.kind.replace(/_/g, " ")}</td>
                  <td>{d.ocrTier ? d.ocrTier.replace(/_/g, " ") : "—"}</td>
                  <td><span className={`pill ${d.status}`}>{d.status.replace(/_/g, " ")}</span></td>
                  <td>{d.recordedAt}</td>
                  <td>
                    <button className="danger" onClick={async () => { await api.deleteDocument(d.id); await load(); }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
