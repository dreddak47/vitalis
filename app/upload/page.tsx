"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Row, MedRow } from "@/lib/extract";

type EditRow = Omit<Row, "value" | "ref_low" | "ref_high" | "code"> & { value: string; ref_low: string; ref_high: string };
const MAX_SIDE = 1600, MAX_PAGES = 10;

async function canvasToJpeg(c: HTMLCanvasElement) {
  return c.toDataURL("image/jpeg", 0.85);
}

/** Images and PDF pages become resized JPEG data URLs, which is what MedGemma (a vision model) reads. */
async function toPages(file: File): Promise<string[]> {
  if (file.type === "application/pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const out: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGES); i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: MAX_SIDE / Math.max(base.width, base.height) });
      const c = document.createElement("canvas");
      c.width = viewport.width; c.height = viewport.height;
      await page.render({ canvas: c, viewport }).promise;
      out.push(await canvasToJpeg(c));
    }
    return out;
  }
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo or a PDF");
  const img = await createImageBitmap(file);
  const s = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return [await canvasToJpeg(c)];
}

const toEdit = (r: Row): EditRow => ({ name: r.name, unit: r.unit, review: r.review, value: String(r.value), ref_low: r.ref_low == null ? "" : String(r.ref_low), ref_high: r.ref_high == null ? "" : String(r.ref_high) });
const num = (s: string) => (s.trim() === "" ? null : Number(s));

export default function UploadPage() {
  const router = useRouter();
  const [pages, setPages] = useState<string[]>([]);
  const [kind, setKind] = useState<"lab_report" | "prescription" | "other">("lab_report");
  const [rows, setRows] = useState<EditRow[]>([]);
  const [meds, setMeds] = useState<MedRow[]>([]);
  const [date, setDate] = useState("");
  const [lab, setLab] = useState("");
  const [status, setStatus] = useState<"idle" | "preparing" | "reading" | "review" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null); setRows([]); setMeds([]); setChecked(false); setStatus("preparing");
    try { setPages(await toPages(f)); setStatus("idle"); } catch (e) { setError((e as Error).message); setStatus("idle"); }
  }

  async function read() {
    setStatus("reading"); setError(null);
    const allRows: EditRow[] = [], allMeds: MedRow[] = [];
    let firstErr: string | null = null;
    for (const image of pages) {
      const res = await fetch("/api/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image }) });
      const data = await res.json().catch(() => ({ error: "Bad response" }));
      if (!res.ok) { firstErr ??= data.error; continue; }
      allRows.push(...data.rows.map(toEdit));
      allMeds.push(...data.meds);
      if (data.date && !date) setDate(data.date);
      if (data.lab && !lab) setLab(data.lab);
    }
    setRows(allRows); setMeds(allMeds);
    if (firstErr) setError(`${firstErr} You can enter the values by hand below.`);
    if (!allRows.length && !allMeds.length && !firstErr) setError("No values found. Add them by hand below.");
    setStatus("review");
  }

  async function save() {
    const bad = rows.find((r) => !r.name.trim() || !Number.isFinite(Number(r.value)) || r.value.trim() === "");
    if (bad) { setError(`Check the row "${bad.name || "(no name)"}": it needs a name and a number.`); return; }
    setStatus("saving"); setError(null);
    const res = await fetch("/api/documents", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind, date: date || null, lab: lab || null, pages,
        rows: rows.map((r) => ({ name: r.name.trim(), value: Number(r.value), unit: r.unit.trim(), ref_low: num(r.ref_low), ref_high: num(r.ref_high) })),
        meds: meds.filter((m) => m.name.trim()),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? "Save failed"); setStatus("review"); return; }
    router.push("/"); router.refresh();
  }

  const setRow = (i: number, patch: Partial<EditRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, review: patch.review ?? null } : r)));
  const setMed = (i: number, patch: Partial<MedRow>) => setMeds((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const input = "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Add a document</h1>
        <p className="text-sm text-slate-600">Photo or PDF of a lab report or prescription. MedGemma reads it, then you check every value before it&apos;s saved.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <label className="cursor-pointer rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white">
          Choose photo or PDF
          <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} data-testid="file" />
        </label>
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Document type" className="rounded-lg border border-slate-300 px-2 py-2 text-sm">
          <option value="lab_report">Lab report</option><option value="prescription">Prescription</option><option value="other">Other</option>
        </select>
        {pages.length > 0 && status !== "review" && (
          <button onClick={read} disabled={status === "reading"} className="rounded-lg border border-teal-700 px-4 py-2 text-sm font-medium text-teal-800 disabled:opacity-60">
            {status === "reading" ? "Reading with MedGemma…" : `Read ${pages.length} page${pages.length > 1 ? "s" : ""}`}
          </button>
        )}
        {pages.length > 0 && status !== "review" && <button onClick={() => setStatus("review")} className="text-sm text-slate-600 underline">Enter by hand</button>}
        {status === "preparing" && <span className="text-sm text-slate-500">Preparing…</span>}
      </div>

      {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      {pages.length > 0 && (
        <div className={`grid gap-4 ${status === "review" || status === "saving" ? "lg:grid-cols-2" : ""}`}>
          <div className="max-h-[75vh] space-y-2 overflow-auto rounded-2xl border border-slate-200 bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {pages.map((p, i) => <img key={i} src={p} alt={`Document page ${i + 1}`} className="w-full rounded" />)}
          </div>

          {(status === "review" || status === "saving") && (
            <div className="space-y-4" data-testid="verify">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-2 flex flex-wrap gap-2">
                  <label className="text-sm">Report date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></label>
                  <label className="flex-1 text-sm">Lab / clinic <input value={lab} onChange={(e) => setLab(e.target.value)} className={input} /></label>
                </div>
                <h2 className="mt-3 font-semibold">Results ({rows.length})</h2>
                <p className="mb-2 text-xs text-slate-500">Compare with the document. Highlighted rows need a closer look.</p>
                <div className="space-y-2">
                  {rows.map((r, i) => (
                    <div key={i} className={`rounded-lg border p-2 ${r.review ? "border-amber-300 bg-amber-50" : "border-slate-200"}`} data-testid="row">
                      <div className="grid grid-cols-12 gap-1.5">
                        <input aria-label="Test name" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} className={`${input} col-span-12 sm:col-span-4`} />
                        <input aria-label={`${r.name} value`} inputMode="decimal" value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} className={`${input} col-span-4 sm:col-span-2 tabular-nums`} />
                        <input aria-label="Unit" value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} className={`${input} col-span-3 sm:col-span-2`} />
                        <input aria-label="Range low" placeholder="low" inputMode="decimal" value={r.ref_low} onChange={(e) => setRow(i, { ref_low: e.target.value })} className={`${input} col-span-2 sm:col-span-2`} />
                        <input aria-label="Range high" placeholder="high" inputMode="decimal" value={r.ref_high} onChange={(e) => setRow(i, { ref_high: e.target.value })} className={`${input} col-span-2 sm:col-span-1`} />
                        <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove ${r.name}`} className="col-span-1 text-slate-400 hover:text-rose-600">✕</button>
                      </div>
                      {r.review && <p className="mt-1 text-xs text-amber-800">{r.review}</p>}
                    </div>
                  ))}
                </div>
                <button onClick={() => setRows((rs) => [...rs, { name: "", value: "", unit: "", ref_low: "", ref_high: "", review: null }])} className="mt-2 text-sm text-teal-700">+ Add result</button>

                <h2 className="mt-4 font-semibold">Medicines ({meds.length})</h2>
                <div className="mt-1 space-y-2">
                  {meds.map((m, i) => (
                    <div key={i} className="grid grid-cols-12 gap-1.5">
                      <input aria-label="Medicine name" value={m.name} onChange={(e) => setMed(i, { name: e.target.value })} className={`${input} col-span-12 sm:col-span-5`} />
                      <input aria-label="Dose" placeholder="dose" value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} className={`${input} col-span-5 sm:col-span-3`} />
                      <input aria-label="Frequency" placeholder="how often" value={m.frequency} onChange={(e) => setMed(i, { frequency: e.target.value })} className={`${input} col-span-6 sm:col-span-3`} />
                      <button onClick={() => setMeds((ms) => ms.filter((_, j) => j !== i))} aria-label={`Remove ${m.name}`} className="col-span-1 text-slate-400 hover:text-rose-600">✕</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => setMeds((ms) => [...ms, { name: "", dose: "", frequency: "" }])} className="mt-2 text-sm text-teal-700">+ Add medicine</button>
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1" />
                I&apos;ve checked these values against the document.
              </label>
              <button onClick={save} disabled={!checked || status === "saving" || (!rows.length && !meds.length)} className="w-full rounded-lg bg-teal-700 py-2.5 font-medium text-white disabled:opacity-50">
                {status === "saving" ? "Saving…" : "Save to my records"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
