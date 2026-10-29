import { currentProfile } from "@/lib/session";
import { q } from "@/lib/db";
import { FREE } from "@/lib/plans";
import { createProfile, deleteProfile, loadDemo, switchProfile } from "../actions";

export default async function Profiles() {
  const { all, profile } = await currentProfile();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Family profiles</h1>
      <p className="text-sm text-slate-600">Keep records for parents, children or a partner. Each person gets their own dashboard. {all.length > FREE.profiles && "More than one profile needs the Family plan."}</p>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {all.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div>
              <p className="font-medium">{p.name} {p.id === profile?.id && <span className="ml-1 rounded bg-teal-50 px-1.5 text-xs text-teal-700">active</span>}</p>
              <p className="text-xs text-slate-500">{q.results(p.id).length} results · {q.docCount(p.id)} documents · {p.view_pref === "simple" ? "simple view" : "detailed view"}</p>
            </div>
            <div className="flex gap-2">
              <form action={switchProfile}><input type="hidden" name="pid" value={p.id} /><button className="rounded-lg border border-slate-300 px-3 py-1 text-sm">Open</button></form>
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-lg px-3 py-1 text-sm text-rose-700 hover:bg-rose-50">Delete</summary>
                <form action={deleteProfile} className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-rose-200 bg-white p-3 text-sm shadow-lg">
                  <p>Permanently delete {p.name} and all their records and documents?</p>
                  <input type="hidden" name="pid" value={p.id} />
                  <button className="mt-2 w-full rounded-lg bg-rose-700 py-1.5 text-white">Delete permanently</button>
                </form>
              </details>
            </div>
          </li>
        ))}
        {!all.length && <li className="p-3 text-sm text-slate-500">No profiles yet.</li>}
      </ul>
      <form action={createProfile} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Add a person</h2>
        <div className="flex flex-wrap gap-2">
          <input name="name" required placeholder="Name" aria-label="Name" className="min-w-40 flex-1 rounded-lg border border-slate-300 px-3 py-2" />
          <input name="dob" type="date" aria-label="Date of birth" className="rounded-lg border border-slate-300 px-3 py-2" />
          <select name="sex" aria-label="Sex" className="rounded-lg border border-slate-300 px-3 py-2"><option value="">Sex</option><option value="F">Female</option><option value="M">Male</option></select>
          <button className="rounded-lg bg-teal-700 px-4 py-2 text-white">Add</button>
        </div>
      </form>
      <form action={loadDemo}><button className="text-sm text-teal-700 underline">Reload demo patients (Synthea)</button></form>
    </div>
  );
}
