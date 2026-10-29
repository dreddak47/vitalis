"use client";
import { useState } from "react";
import TrendChart from "@/components/TrendChart";
import type { Answer } from "@/lib/ask";

const EXAMPLES = ["How has my HbA1c changed since I started metformin?", "Show my cholesterol since 2020", "How are my kidneys doing?", "Blood pressure trend"];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(text: string) {
    if (text.trim().length < 2) return;
    setQuestion(text);
    setBusy(true); setError(null); setAnswer(null);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: text }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnswer(data);
    } catch (e) {
      setError((e as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Ask your records</h1>
        <p className="text-sm text-slate-600">Ask in plain words. You get a chart built from your own results. The AI picks what to show, and every number comes from your records.</p>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); submit(question); }} className="flex gap-2">
        <label htmlFor="q" className="sr-only">Question</label>
        <input id="q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Has my LDL improved since 2021?" className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2" />
        <button disabled={busy} className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white disabled:opacity-60">{busy ? "Thinking…" : "Ask"}</button>
      </form>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((x) => <button key={x} onClick={() => submit(x)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">{x}</button>)}
      </div>

      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
      {answer && (
        <div className="space-y-3" data-testid="answer">
          {answer.notice && <p role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{answer.notice}</p>}
          <p className="text-sm text-slate-700">{answer.caption}</p>
          {answer.charts.map((c) => (
            <section key={c.code} className="rounded-2xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 font-semibold">{c.name} <span className="text-sm font-normal text-slate-500">({c.unit})</span></h2>
              <TrendChart data={c} height={240} />
              {c.effects.map((e) => (
                <p key={e.med} className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">Year before {e.med}: avg {e.before} → year after: avg {e.after} {c.unit} (association only)</p>
              ))}
            </section>
          ))}
          <p className="text-xs text-slate-400">Query chosen by {answer.source === "ai" ? "MedGemma" : "keyword matching"}.</p>
        </div>
      )}
    </div>
  );
}
