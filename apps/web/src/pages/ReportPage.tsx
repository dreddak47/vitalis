import { useCallback, useEffect, useState } from "react";
import type { ReportSpec } from "@vitalis/shared";
import { api } from "../api";
import { SectionCard } from "../report/sections";

export function ReportPage() {
  const [report, setReport] = useState<ReportSpec | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; generatedAt: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    setHistory(await api.listReports());
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.generateReport());
      await refreshHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const load = async (id: string) => {
    setError(null);
    setReport(await api.getReport(id));
  };

  return (
    <>
      <div className="page-head">
        <h1>Your Health Report</h1>
        <div className="btn-row">
          <button className="primary" onClick={generate} disabled={busy}>
            {busy ? "Generating…" : "Generate report"}
          </button>
          {report && (
            <a href={api.downloadUrl(report.id)}>
              <button>⬇ Download (HTML)</button>
            </a>
          )}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {!report && (
        <div className="card empty">
          <p>No report generated in this session yet.</p>
          <p className="legend">
            Reports are compiled on the server from your verified records, profile and display
            preferences — the section layout you get is unique to your age, conditions and focus
            areas. {history.length > 0 && "Or load a previous one below."}
          </p>
        </div>
      )}

      {report && (
        <>
          <p className="meta">
            Generated {new Date(report.generatedAt).toLocaleString()} · persona:{" "}
            {report.persona.ageBand.replace(/_/g, " ")}
            {report.persona.tags.length > 0 && <> · focus: {report.persona.tags.join(", ")}</>}
          </p>
          {report.sections.map((s) => (
            <SectionCard key={s.id} section={s} />
          ))}
          <p className="disclaimer"><strong>Disclaimer.</strong> {report.disclaimer}</p>
        </>
      )}

      {history.length > 0 && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2>Previous reports</h2>
          <ul className="tight">
            {history.map((h) => (
              <li key={h.id}>
                <a href="#" onClick={(e) => { e.preventDefault(); void load(h.id); }}>
                  {new Date(h.generatedAt).toLocaleString()}
                </a>{" "}
                <a href={api.downloadUrl(h.id)} className="legend">⬇</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
