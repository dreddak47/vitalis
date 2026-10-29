// Live MedGemma extraction accuracy on the generated reports (run `npm run reports` first).
// Usage: LLM_API_KEY=hf_... npm run eval
import fs from "node:fs";
import path from "node:path";
import { extractImage, toRows } from "../lib/extract";
import { llmConfigured } from "../lib/llm";
import { flag, testByCode } from "../lib/tests";

const DIR = path.join(process.env.VITALIS_DATA_DIR ?? "data", "reports");
type Truth = { file: string; kind: string; date: string; results: { code: string; value: number }[]; meds: string[] };

async function main() {
  if (!llmConfigured()) { console.error("Set LLM_API_KEY (or LLM_BASE_URL for a local server) first."); process.exit(1); }
  const truth: Truth[] = JSON.parse(fs.readFileSync(path.join(DIR, "truth.json"), "utf8"));
  let found = 0, exact = 0, flags = 0, total = 0, medsHit = 0, medsTotal = 0, dates = 0, extra = 0, failed = 0;
  for (const t of truth) {
    const img = `data:image/png;base64,${fs.readFileSync(path.join(DIR, t.file)).toString("base64")}`;
    const t0 = Date.now();
    try {
      const out = toRows(await extractImage(img));
      let f = 0, e = 0, fl = 0;
      for (const r of t.results) {
        const row = out.rows.find((x) => x.code === r.code);
        if (row) {
          f++;
          if (Math.abs(row.value - r.value) <= Math.max(0.011, Math.abs(r.value) * 0.02)) e++;
          // The report prints the catalog range, so the badge the user sees should match it.
          const def = testByCode(r.code)!;
          if (flag(row.value, row.ref_low, row.ref_high) === flag(r.value, def.low, def.high)) fl++;
        }
      }
      const m = t.meds.filter((name) => out.meds.some((x) => x.name.toLowerCase().includes(name.split(" ")[0].toLowerCase()))).length;
      extra += out.rows.filter((x) => !t.results.some((r) => r.code === x.code)).length;
      found += f; exact += e; flags += fl; total += t.results.length; medsHit += m; medsTotal += t.meds.length; dates += out.date === t.date ? 1 : 0;
      console.log(`${t.file}  tests ${f}/${t.results.length} found, ${e} exact, ${fl} flag ok · meds ${m}/${t.meds.length} · date ${out.date === t.date ? "ok" : `✗ ${out.date}`} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (err) {
      failed++; total += t.results.length; medsTotal += t.meds.length;
      console.log(`${t.file}  FAILED: ${(err as Error).message}`);
    }
  }
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");
  console.log(`\nTest recognised: ${pct(found, total)} · value exact (±2%, after unit conversion): ${pct(exact, total)} · in/out-of-range flag: ${pct(flags, total)} · medicines: ${pct(medsHit, medsTotal)} · dates: ${pct(dates, truth.length)} · extra rows: ${extra} · failed calls: ${failed}`);
}
main();
