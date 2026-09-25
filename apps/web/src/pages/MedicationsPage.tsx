import { useCallback, useEffect, useState } from "react";
import type { HealthRecords } from "@vitalis/shared";
import { api } from "../api";

export function MedicationsPage() {
  const [records, setRecords] = useState<HealthRecords | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRecords(await api.getRecords());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const verify = async (factId: string) => {
    await api.verifyFact("medications", factId);
    await load();
  };

  if (error) return <div className="error-box">{error}</div>;
  if (!records) return <p className="meta">Loading…</p>;

  const active = records.medications.filter((m) => m.status === "active");
  const past = records.medications.filter((m) => m.status === "discontinued");

  return (
    <>
      <div className="page-head"><h1>Medications</h1></div>

      <div className="card">
        <h2>Active ({active.length})</h2>
        {active.length === 0 ? (
          <p className="empty">No active medications extracted yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Prescriber</th><th>Started</th><th>Verification</th><th></th></tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.id}>
                  <td>{m.drugName}</td>
                  <td>{m.dose ? `${m.dose.amount} ${m.dose.unit}` : "—"}</td>
                  <td>{m.frequency ?? "—"}</td>
                  <td>{m.prescriber ?? "—"}</td>
                  <td>{m.startDate ?? "—"}</td>
                  <td><span className={`pill ${m.verification}`}>{m.verification.replace("_", " ")}</span></td>
                  <td>
                    {m.verification === "unverified" && (
                      <button onClick={() => void verify(m.id)}>Confirm</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {past.length > 0 && (
        <div className="card">
          <h2>Discontinued ({past.length})</h2>
          <table>
            <thead><tr><th>Drug</th><th>Dose</th><th>Ended</th><th>Verification</th></tr></thead>
            <tbody>
              {past.map((m) => (
                <tr key={m.id}>
                  <td>{m.drugName}</td>
                  <td>{m.dose ? `${m.dose.amount} ${m.dose.unit}` : "—"}</td>
                  <td>{m.endDate ?? "—"}</td>
                  <td><span className={`pill ${m.verification}`}>{m.verification.replace("_", " ")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Coming next</h2>
        <p className="legend">
          This tab is built as the anchor for expansion: refill reminders, drug–drug interaction
          checks against your allergy list, and adherence tracking are designed but not wired in —
          see docs/IMPROVEMENTS.md.
        </p>
      </div>
    </>
  );
}
