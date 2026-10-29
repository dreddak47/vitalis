import { z } from "zod";
import { chatJson } from "./llm";
import { nearTest, normalizeResult, testByCode } from "./tests";

const today = () => new Date().toISOString().slice(0, 10);

const num = z.union([z.number(), z.string()]).nullish().transform((v) => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, "").replace(/^[<>≤≥]=?\s*/, ""));
  return Number.isFinite(n) ? n : null;
});

const N = String.raw`(\d+(?:\.\d+)?)`;
/** Reference range text as printed → bounds. Code reads "<" and ">" so the model can't put a limit on the wrong side. */
export function parseRange(text: string): { low: number | null; high: number | null } | null {
  const t = text.replace(/,/g, "").trim();
  let m;
  if ((m = t.match(new RegExp(`^${N}\\s*(?:-|–|—|to)\\s*${N}`)))) return { low: +m[1], high: +m[2] };
  if ((m = t.match(new RegExp(`^(?:<=?|≤|up to|upto|below|less than)\\s*${N}`, "i")))) return { low: null, high: +m[1] };
  if ((m = t.match(new RegExp(`^(?:>=?|≥|above|more than|greater than)\\s*${N}`, "i")) ?? t.match(new RegExp(`^${N}\\s*(?:\\+|and above)`, "i")))) return { low: +m[1], high: null };
  return null;
}

export const ExtractSchema = z.object({
  document_type: z.string().default("other"),
  report_date: z.string().nullish(),
  lab_name: z.string().nullish(),
  results: z.array(z.object({ name: z.string(), value: num, unit: z.string().nullish(), ref_range: z.string().nullish(), ref_low: num, ref_high: num })).default([]),
  medications: z.array(z.object({ name: z.string(), dose: z.string().nullish(), frequency: z.string().nullish(), duration: z.string().nullish() })).default([]),
});
export type Extracted = z.infer<typeof ExtractSchema>;

export type Row = { name: string; code: string | null; value: number; unit: string; ref_low: number | null; ref_high: number | null; review: string | null };
export type MedRow = { name: string; dose: string; frequency: string };

const PROMPT = `You are reading a medical document image. Transcribe it exactly into JSON. Do not interpret, diagnose or add anything that is not printed.
Return:
{"document_type":"lab_report"|"prescription"|"other",
 "report_date":"YYYY-MM-DD or null (sample collection or report date)",
 "lab_name":"string or null",
 "results":[{"name":"test name as printed","value":number,"unit":"unit as printed","ref_range":"reference range exactly as printed, e.g. \"4.0 - 5.6\" or \"< 200\", or null"}],
 "medications":[{"name":"medicine name with strength","dose":"e.g. 1 tablet","frequency":"e.g. twice daily","duration":"e.g. 30 days or null"}]}
Only numeric results go in "results". Copy ref_range character for character, including any < or > sign. Reply with JSON only.`;

export async function extractImage(dataUrl: string): Promise<Extracted> {
  return chatJson(
    [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUrl } }, { type: "text", text: PROMPT }] }],
    ExtractSchema,
    { maxTokens: 2500 },
  );
}

/** Normalize model output into rows the user verifies. Anything we can't trust gets a review note. */
export function toRows(x: Extracted): { rows: Row[]; meds: MedRow[]; date: string | null; lab: string | null } {
  const rows: Row[] = [];
  for (const r of x.results) {
    if (r.value == null) continue;
    // Prefer the printed range text; numeric bounds are a fallback. A collapsed pair ("< 200" → 200/200) is an upper limit only.
    const pr = r.ref_range ? parseRange(r.ref_range) : null;
    const lo = pr ? pr.low : r.ref_low != null && !(r.ref_high != null && r.ref_low >= r.ref_high * 0.95) ? r.ref_low : null;
    const hi = pr ? pr.high : r.ref_high;
    let n = normalizeResult(r.name, r.value, r.unit ?? "", lo, hi);
    const near = n.code ? undefined : nearTest(r.name, r.unit ?? "");
    if (near) n = normalizeResult(near.name, r.value, r.unit ?? "", lo, hi);
    const def = n.code ? testByCode(n.code) : undefined;
    let review: string | null = null;
    if (near) review = `Read as "${r.name}", matched to ${near.name}. Check it`;
    else if (!n.code) review = "Unrecognised test name — check it";
    else if (n.needsReview) review = `Unit "${r.unit}" not recognised for ${n.name}`;
    // A value 10x past the reference limit is more often a misread than reality.
    else if (def?.high && n.value > def.high * 10) review = "Unusually high — check the value";
    rows.push({ name: n.name, code: n.code, value: n.value, unit: n.unit, ref_low: n.low ?? null, ref_high: n.high ?? null, review });
  }
  let date = x.report_date && /^\d{4}-\d{2}-\d{2}$/.test(x.report_date) ? x.report_date : null;
  // DD/MM vs MM/DD mix-up: a future date whose day/month swap is a valid past date was almost certainly misread.
  // ponytail: only catches swaps that land in the future; the user still checks the date on the verify screen.
  if (date && date > today()) {
    const [y, m, d] = date.split("-");
    const swapped = `${y}-${d}-${m}`;
    if (+d <= 12 && swapped <= today()) date = swapped;
  }
  return {
    rows,
    meds: x.medications.map((m) => ({ name: m.name, dose: m.dose ?? "", frequency: [m.frequency, m.duration].filter(Boolean).join(", ") })),
    date,
    lab: x.lab_name ?? null,
  };
}

export const customCode = (name: string) => `x:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
