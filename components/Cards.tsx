import Link from "next/link";
import { q, latestByTest } from "@/lib/db";
import { flag, testByCode, type Flag } from "@/lib/tests";
import { trendData } from "@/lib/trend";
import { shortMed, type Card } from "@/lib/layout";
import { togglePin } from "@/app/actions";
import TrendChart from "./TrendChart";

export const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : String(Math.round(v * 100) / 100));
export const range = (lo: number | null, hi: number | null) => (lo != null && hi != null ? `${fmt(lo)}–${fmt(hi)}` : lo != null ? `≥ ${fmt(lo)}` : hi != null ? `≤ ${fmt(hi)}` : "—");
export const GROUP_LABEL: Record<string, string> = { diabetes: "Blood sugar", kidney: "Kidney", lipids: "Cholesterol", cbc: "Blood count", liver: "Liver", electrolytes: "Electrolytes", thyroid: "Thyroid", vitals: "Vitals", cardiac: "Heart", vitamins: "Vitamins", other: "Other" };

export function FlagBadge({ f }: { f: Flag }) {
  if (f === "normal") return <span className="whitespace-nowrap rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">In range</span>;
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${f === "high" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800"}`}>{f === "high" ? "Above range" : "Below range"}</span>;
}

function Shell({ card, title, children }: { card: Card; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-card={card.key}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-slate-900">{title}</h2>
        <form action={togglePin}>
          <input type="hidden" name="key" value={card.key} />
          <button className={`rounded-md px-2 py-1 text-xs ${card.pinned ? "bg-teal-700 text-white" : "text-slate-500 hover:bg-slate-100"}`} aria-pressed={!!card.pinned} aria-label={card.pinned ? `Unpin ${title}` : `Pin ${title}`}>
            {card.pinned ? "Pinned" : "Pin"}
          </button>
        </form>
      </div>
      <p className="mt-0.5 mb-3 text-xs text-slate-500"><span aria-hidden>✦ </span>{card.why}</p>
      {children}
    </section>
  );
}

function TrendCard({ card, pid }: { card: Card; pid: number }) {
  const d = trendData(pid, card.code!);
  if (!d) return null;
  const last = d.points.at(-1)!, prev = d.points.at(-2);
  const f = flag(last.v, d.low, d.high);
  return (
    <Shell card={card} title={d.name}>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-slate-900">{fmt(last.v)}</span>
        <span className="text-sm text-slate-500">{d.unit}</span>
        <FlagBadge f={f} />
      </div>
      <p className="text-xs text-slate-500">
        {new Date(last.t).toLocaleDateString()} · range {range(d.low, d.high)}
        {prev && <> · previous {fmt(prev.v)}</>}
      </p>
      <div className="mt-2"><TrendChart data={d} height={140} compact /></div>
      {d.effects[0] && (
        <p className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          Year before starting <b>{d.effects[0].med}</b>: avg {fmt(d.effects[0].before)} → year after: avg {fmt(d.effects[0].after)} {d.unit}
        </p>
      )}
      <Link href={`/trends/${encodeURIComponent(d.code)}`} className="mt-2 inline-block text-sm font-medium text-teal-700 hover:underline">Full history →</Link>
    </Shell>
  );
}

function AbnormalCard({ card, pid }: { card: Card; pid: number }) {
  const rows = [...latestByTest(pid).values()].filter((r) => flag(r.value, r.ref_low, r.ref_high) !== "normal");
  return (
    <Shell card={card} title="Outside reference range">
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <Link href={`/trends/${encodeURIComponent(r.test_code!)}`} className="text-slate-800 hover:underline">{r.test_name}</Link>
            <span className="flex items-center gap-2 tabular-nums">
              <b>{fmt(r.value)}</b><span className="text-xs text-slate-500">{r.unit} ({range(r.ref_low, r.ref_high)})</span>
              <FlagBadge f={flag(r.value, r.ref_low, r.ref_high)} />
            </span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function LatestCard({ card, pid }: { card: Card; pid: number }) {
  const rows = [...latestByTest(pid).values()].filter((r) => (testByCode(r.test_code!)?.group ?? "other") === card.group);
  return (
    <Shell card={card} title={`Latest: ${GROUP_LABEL[card.group!] ?? card.group}`}>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="py-1.5"><Link href={`/trends/${encodeURIComponent(r.test_code!)}`} className="hover:underline">{r.test_name}</Link></td>
              <td className="py-1.5 text-right tabular-nums">{fmt(r.value)} <span className="text-xs text-slate-500">{r.unit}</span></td>
              <td className="py-1.5 pl-2 text-right"><FlagBadge f={flag(r.value, r.ref_low, r.ref_high)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
}

function MedsCard({ card, pid }: { card: Card; pid: number }) {
  const meds = q.meds(pid).filter((m) => !m.end_date);
  return (
    <Shell card={card} title="Current medicines">
      <ul className="space-y-1.5 text-sm">
        {meds.map((m) => (
          <li key={m.id} className="flex justify-between gap-2">
            <span title={m.name}>{shortMed(m.name)} {m.dose && <span className="text-slate-500">{m.dose}</span>}</span>
            <span className="shrink-0 text-xs text-slate-500">since {m.start_date?.slice(0, 7) ?? "?"}</span>
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function TimelineCard({ card, pid }: { card: Card; pid: number }) {
  const events = [
    ...q.docs(pid).map((d) => ({ t: d.report_date ?? d.uploaded_at.slice(0, 10), text: `${d.kind === "prescription" ? "Prescription" : d.kind === "lab_report" ? "Lab report" : "Document"} added${d.lab ? ` · ${d.lab}` : ""}`, href: d.file_path ? `/api/documents/${d.id}` : undefined })),
    ...q.meds(pid).flatMap((m) => [
      ...(m.start_date ? [{ t: m.start_date, text: `Started ${shortMed(m.name)}`, href: undefined }] : []),
      ...(m.end_date ? [{ t: m.end_date, text: `Stopped ${shortMed(m.name)}`, href: undefined }] : []),
    ]),
  ].filter((e) => e.t <= new Date().toISOString().slice(0, 10)).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 8);
  return (
    <Shell card={card} title="Timeline">
      {events.length ? (
        <ol className="space-y-2 border-l border-slate-200 pl-3 text-sm">
          {events.map((e, i) => (
            <li key={i}><span className="text-xs text-slate-500">{e.t}</span> · {e.href ? <a href={e.href} target="_blank" className="text-teal-700 hover:underline">{e.text}</a> : e.text}</li>
          ))}
        </ol>
      ) : <p className="text-sm text-slate-500">Nothing yet.</p>}
    </Shell>
  );
}

export function CardView({ card, pid }: { card: Card; pid: number }) {
  switch (card.type) {
    case "trend": return <TrendCard card={card} pid={pid} />;
    case "abnormal": return <AbnormalCard card={card} pid={pid} />;
    case "latest": return <LatestCard card={card} pid={pid} />;
    case "meds": return <MedsCard card={card} pid={pid} />;
    case "timeline": return <TimelineCard card={card} pid={pid} />;
  }
}
