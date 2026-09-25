import type { ReportSection } from "@vitalis/shared";
import type { ReactNode } from "react";
import { Sparkline } from "../components/Sparkline";

/**
 * Generative UI renderer.
 *
 * The server sends a ReportSpec; this registry maps each section `kind` to a
 * component. Unknown kinds fall back to <details> with raw JSON, so the API
 * can add new section types without a frontend deploy.
 */

type Props = Record<string, unknown>;

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function Headline({ paragraphs }: { paragraphs: unknown }) {
  return (
    <>
      {asArray<string>(paragraphs).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </>
  );
}

function RiskFlags({ flags }: { flags: unknown }) {
  return (
    <table>
      <thead>
        <tr><th>Item</th><th>Reading</th><th>Status</th><th>Date</th></tr>
      </thead>
      <tbody>
        {asArray<{ label: string; detail: string; severity: string; measuredAt: string | null }>(flags).map(
          (f, i) => (
            <tr key={i}>
              <td>{f.label}</td>
              <td>{f.detail}</td>
              <td><span className={`pill ${f.severity}`}>{f.severity}</span></td>
              <td>{f.measuredAt ?? "—"}</td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}

interface LabSeries {
  analyte: string;
  displayName: string;
  unit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  points: Array<{ date: string | null; value: number | null; flag: string | null }>;
}

function LabTrends({ series }: { series: unknown }) {
  return (
    <>
      {asArray<LabSeries>(series).map((s) => (
        <div key={s.analyte} style={{ marginBottom: "1rem" }}>
          <strong>{s.displayName}</strong>{" "}
          <span className="legend">
            {s.unit ?? ""}
            {s.referenceHigh !== null ? ` · ref ${s.referenceLow ?? "–"}–${s.referenceHigh}` : ""}
          </span>
          <Sparkline points={s.points} referenceLow={s.referenceLow} referenceHigh={s.referenceHigh} />
        </div>
      ))}
    </>
  );
}

function MedicationList({ active, discontinued, needsReview }: { active: unknown; discontinued: unknown; needsReview: unknown }) {
  const act = asArray<{
    id: string; drugName: string;
    dose: { amount: number; unit: string } | null;
    frequency: string | null; instructions: string | null; verification: string;
  }>(active);
  const dis = asArray<{ id: string; drugName: string; endDate: string | null }>(discontinued);
  return (
    <>
      <table>
        <thead><tr><th>Drug</th><th>Dose</th><th>Frequency</th><th>Instructions</th><th>Status</th></tr></thead>
        <tbody>
          {act.map((m) => (
            <tr key={m.id}>
              <td>{m.drugName}</td>
              <td>{m.dose ? `${m.dose.amount} ${m.dose.unit}` : "—"}</td>
              <td>{m.frequency ?? "—"}</td>
              <td>{m.instructions ?? "—"}</td>
              <td><span className={`pill ${m.verification}`}>{m.verification.replace("_", " ")}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {dis.length > 0 && (
        <p className="legend">
          Discontinued: {dis.map((m) => `${m.drugName} (${m.endDate ?? "?"})`).join(", ")}
        </p>
      )}
      {typeof needsReview === "number" && needsReview > 0 && (
        <p className="legend">⚠ {needsReview} entr{needsReview === 1 ? "y" : "ies"} awaiting verification on the Documents page.</p>
      )}
    </>
  );
}

function MedicationAdherence({ schedule }: { schedule: unknown }) {
  return (
    <table>
      <thead><tr><th>Drug</th><th>Schedule</th><th>Dose</th><th></th></tr></thead>
      <tbody>
        {asArray<{ drugName: string; frequency: string | null; dose: { amount: number; unit: string } | null; endingSoon: boolean }>(
          schedule
        ).map((s, i) => (
          <tr key={i}>
            <td>{s.drugName}</td>
            <td>{s.frequency ?? "—"}</td>
            <td>{s.dose ? `${s.dose.amount} ${s.dose.unit}` : "—"}</td>
            <td>{s.endingSoon && <span className="pill high">course ends within a week</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VitalsChart({ groups }: { groups: unknown }) {
  return (
    <>
      {asArray<{ kind: string; points: Array<{ date: string | null; value: number | null; secondary: number | null; unit: string | null }> }>(
        groups
      ).map((g) => (
        <div key={g.kind} style={{ marginBottom: "1rem" }}>
          <strong>{g.kind.replace(/_/g, " ")}</strong>
          <Sparkline points={g.points} />
          <table>
            <tbody>
              {g.points.map((p, i) => (
                <tr key={i}>
                  <td>{p.date ?? "—"}</td>
                  <td>
                    {p.value ?? "—"}
                    {p.secondary !== null ? `/${p.secondary}` : ""} {p.unit ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function ConditionTimeline({ conditions }: { conditions: unknown }) {
  return (
    <table>
      <thead><tr><th>Condition</th><th>ICD-10</th><th>Status</th><th>Since</th></tr></thead>
      <tbody>
        {asArray<{ name: string; icd10: string | null; status: string | null; diagnosedAt: string | null }>(
          conditions
        ).map((c, i) => (
          <tr key={i}>
            <td>{c.name}</td>
            <td>{c.icd10 ?? "—"}</td>
            <td>{c.status ?? "—"}</td>
            <td>{c.diagnosedAt ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AllergyAlerts({ allergies }: { allergies: unknown }) {
  return (
    <ul className="tight">
      {asArray<{ substance: string; reaction: string | null; severity: string | null }>(allergies).map((a, i) => (
        <li key={i}>
          <strong>{a.substance}</strong> — {a.reaction ?? "reaction not recorded"}{" "}
          {a.severity && <span className={`pill ${a.severity === "severe" ? "critical" : "low"}`}>{a.severity}</span>}
        </li>
      ))}
    </ul>
  );
}

function PreventiveCare({ items }: { items: unknown }) {
  return (
    <ul className="tight">
      {asArray<{ item: string; reason: string; overdue: boolean }>(items).map((it, i) => (
        <li key={i}>
          {it.item} <span className="legend">({it.reason})</span>{" "}
          {it.overdue ? <span className="pill high">due</span> : <span className="pill normal">up to date</span>}
        </li>
      ))}
    </ul>
  );
}

function DocumentsDigest({ total, byKind, needsReview, failed }: { total: unknown; byKind: unknown; needsReview: unknown; failed: unknown }) {
  const kinds = Object.entries((byKind as Record<string, number>) ?? {});
  return (
    <>
      <p>
        {String(total)} documents on file ({kinds.map(([k, n]) => `${k.replace(/_/g, " ")} ×${n}`).join(", ")}
        ){typeof failed === "number" && failed > 0 ? `, ${failed} failed` : ""}.
      </p>
      {asArray<{ id: string; title: string }>(needsReview).length > 0 && (
        <>
          <p>Awaiting your review:</p>
          <ul className="tight">
            {asArray<{ id: string; title: string }>(needsReview).map((d) => (
              <li key={d.id}>{d.title}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function LifestyleNotes({ notes }: { notes: unknown }) {
  const items = asArray<{ note: string; date: string | null }>(notes);
  if (items.length === 0) return <p className="legend">No lifestyle notes extracted yet.</p>;
  return (
    <ul className="tight">
      {items.map((n, i) => (
        <li key={i}>{n.note} <span className="legend">{n.date ?? ""}</span></li>
      ))}
    </ul>
  );
}

const REGISTRY: Record<string, (props: Props) => ReactNode> = {
  headline: (p) => <Headline paragraphs={p.paragraphs} />,
  risk_flags: (p) => <RiskFlags flags={p.flags} />,
  lab_trends: (p) => <LabTrends series={p.series} />,
  medication_list: (p) => <MedicationList active={p.active} discontinued={p.discontinued} needsReview={p.needsReview} />,
  medication_adherence: (p) => <MedicationAdherence schedule={p.schedule} />,
  vitals_chart: (p) => <VitalsChart groups={p.groups} />,
  condition_timeline: (p) => <ConditionTimeline conditions={p.conditions} />,
  allergy_alerts: (p) => <AllergyAlerts allergies={p.allergies} />,
  preventive_care: (p) => <PreventiveCare items={p.items} />,
  documents_digest: (p) => <DocumentsDigest total={p.total} byKind={p.byKind} needsReview={p.needsReview} failed={p.failed} />,
  lifestyle_notes: (p) => <LifestyleNotes notes={p.notes} />,
};

export function SectionCard({ section }: { section: ReportSection }) {
  const render = REGISTRY[section.kind];
  return (
    <section className="card">
      <h2>{section.title}</h2>
      <p className="rationale">Why you see this: {section.rationale}</p>
      {render ? (
        render(section.props as Props)
      ) : (
        <details>
          <summary>Unknown section type: {section.kind}</summary>
          <pre>{JSON.stringify(section.props, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
