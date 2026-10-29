import { PLANS } from "@/lib/plans";

export default function Plans() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Plans</h1>
        <p className="text-sm text-slate-600">Start free. Upgrade when you manage more records or your family&apos;s health.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => (
          <section key={p.id} className={`rounded-2xl border bg-white p-5 ${p.id === "family" ? "border-teal-700 ring-1 ring-teal-700" : "border-slate-200"}`}>
            {p.id === "family" && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-teal-700">Best for caregivers</p>}
            <h2 className="text-lg font-semibold">{p.name}</h2>
            <p className="mt-1"><span className="text-3xl font-semibold">{p.price}</span><span className="text-slate-500">{p.per}</span></p>
            <ul className="mt-3 space-y-1 text-sm">{p.features.map((f) => <li key={f}>✓ {f}</li>)}</ul>
            <button disabled className="mt-4 w-full rounded-lg border border-slate-300 py-2 text-sm text-slate-500" title="Payments are not enabled in this preview">
              {p.id === "free" ? "Current plan" : "Coming soon"}
            </button>
          </section>
        ))}
      </div>
      <p className="text-xs text-slate-500">Payments aren&apos;t enabled in this preview. Limits are shown but not enforced.</p>
    </div>
  );
}
