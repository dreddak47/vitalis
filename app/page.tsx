import Link from "next/link";
import { currentProfile } from "@/lib/session";
import { getLayout } from "@/lib/layout";
import { q } from "@/lib/db";
import { llmConfigured } from "@/lib/llm";
import { FREE } from "@/lib/plans";
import { CardView } from "@/components/Cards";
import { loadDemo, setViewPref, createProfile } from "./actions";

export default async function Home() {
  const { all, profile } = await currentProfile();
  if (!profile) return <Onboarding />;

  const { cards, source } = await getLayout(profile.id);
  const docs = q.docCount(profile.id);
  const own = all.filter((p) => !p.demo_source).length; // demo patients don't count toward plan limits
  const overFree = own > FREE.profiles || docs > FREE.docs;
  const simple = profile.view_pref === "simple";
  const empty = !q.results(profile.id).length && !q.meds(profile.id).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{profile.name.replace(/\s*\(demo.*\)/, "")}</h1>
          <p className="text-sm text-slate-500" data-testid="layout-source">
            {source.endsWith("ai") ? "Dashboard arranged by MedGemma from your records" : "Dashboard arranged from your records"} · updates when new data arrives
          </p>
        </div>
        <form action={setViewPref} className="flex items-center gap-2">
          <input type="hidden" name="pref" value={simple ? "standard" : "simple"} />
          <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">{simple ? "Detailed view" : "Simple large view"}</button>
        </form>
      </div>

      {overFree && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You&apos;re using {own} profiles and {docs} documents. The free plan covers {FREE.profiles} profile and {FREE.docs} documents. <Link href="/plans" className="font-medium underline">See plans</Link>
        </div>
      )}
      {!llmConfigured() && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          MedGemma isn&apos;t connected, so the dashboard uses built-in rules and uploads need manual entry. Set <code>LLM_API_KEY</code> to enable it (see README).
        </div>
      )}

      {!empty ? (
        <div className={`grid gap-4 ${simple ? "" : "md:grid-cols-2"}`}>
          {cards.map((c) => <CardView key={c.key} card={c} pid={profile.id} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-slate-700">No results yet for this profile.</p>
          <Link href="/upload" className="mt-3 inline-block rounded-lg bg-teal-700 px-4 py-2 text-white">Upload a lab report</Link>
        </div>
      )}
    </div>
  );
}

function Onboarding() {
  return (
    <div className="mx-auto max-w-lg space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Your health records, arranged for you</h1>
        <p className="mt-2 text-slate-600">Upload lab reports and prescriptions. Vitalis reads them with Google&apos;s MedGemma, you confirm the values, and the dashboard rearranges itself around what matters for your health.</p>
      </div>
      <form action={createProfile} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Create your profile</h2>
        <input name="name" required placeholder="Name" aria-label="Name" className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        <div className="flex gap-2">
          <input name="dob" type="date" aria-label="Date of birth" className="flex-1 rounded-lg border border-slate-300 px-3 py-2" />
          <select name="sex" aria-label="Sex" className="rounded-lg border border-slate-300 px-3 py-2"><option value="">Sex</option><option value="F">Female</option><option value="M">Male</option></select>
        </div>
        <button className="w-full rounded-lg bg-teal-700 py-2 font-medium text-white">Create profile</button>
      </form>
      <form action={loadDemo} className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold">Or explore with demo patients</h2>
        <p className="mt-1 text-sm text-slate-600">Loads 3 synthetic patients from the open Synthea dataset (diabetes, heart disease, anemia) with years of lab history.</p>
        <button className="mt-3 rounded-lg border border-teal-700 px-4 py-2 font-medium text-teal-800">Load demo patients</button>
      </form>
    </div>
  );
}
