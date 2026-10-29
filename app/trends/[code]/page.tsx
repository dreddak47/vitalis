import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentProfile } from "@/lib/session";
import { trendData } from "@/lib/trend";
import { q } from "@/lib/db";
import { flag } from "@/lib/tests";
import TrendChart from "@/components/TrendChart";
import { FlagBadge, fmt, range } from "@/components/Cards";

export default async function TrendPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ all?: string }> }) {
  const { profile } = await currentProfile();
  if (!profile) redirect("/");
  const code = decodeURIComponent((await params).code);
  const allMeds = (await searchParams).all === "1";
  const d = trendData(profile.id, code, { allMeds });
  if (!d) notFound();
  const rows = q.results(profile.id, code).reverse();

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-teal-700">← Home</Link>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-slate-900">{d.name}</h1>
        <p className="text-sm text-slate-500">Reference range {range(d.low, d.high)} {d.unit}</p>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <TrendChart data={d} height={320} />
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-600">
          <span><span className="mr-1 inline-block h-2.5 w-4 rounded bg-emerald-500/20 align-middle" />Reference range</span>
          <span className="text-indigo-700">┆ ▶ medicine started</span>
          <span className="text-rose-600">┆ ■ medicine stopped</span>
          <Link href={allMeds ? "?" : "?all=1"} className="ml-auto text-teal-700 hover:underline">{allMeds ? "Show related medicines only" : "Show all medicines"}</Link>
        </div>
      </section>

      {d.effects.length > 0 && (
        <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
          <h2 className="font-semibold text-indigo-950">Medicines and this result</h2>
          <p className="mb-2 text-xs text-indigo-800">Average of your results in the year before vs. the year after each start (first month skipped). Shows association only. Many things affect results.</p>
          <ul className="space-y-1 text-sm">
            {d.effects.map((e) => (
              <li key={e.med + e.start}><b>{e.med}</b> (started {e.start}): {fmt(e.before)} → {fmt(e.after)} {d.unit} <span className="text-xs text-indigo-700">({e.nBefore} vs {e.nAfter} results)</span></li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">All results ({rows.length})</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Date</th><th className="text-right">Value</th><th className="text-right">Status</th><th className="text-right">Source</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5">{r.taken_at}</td>
                <td className="text-right tabular-nums">{fmt(r.value)} {r.unit}</td>
                <td className="text-right"><FlagBadge f={flag(r.value, r.ref_low, r.ref_high)} /></td>
                <td className="text-right text-xs">{r.document_id ? <a className="text-teal-700 hover:underline" href={`/api/documents/${r.document_id}`} target="_blank">document</a> : <span className="text-slate-400">imported</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
