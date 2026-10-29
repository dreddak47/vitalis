// Renders realistic lab report / prescription images with KNOWN values, so MedGemma extraction accuracy can be measured.
// Output: data/reports/report-XX.png + data/reports/truth.json
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { TESTS } from "../lib/tests";

const OUT = path.join(process.env.VITALIS_DATA_DIR ?? "data", "reports");
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

type Truth = { file: string; kind: "lab_report" | "prescription"; date: string; results: { code: string; value: number }[]; meds: string[] };

const PANELS = [
  ["4548-4", "2345-7", "2160-0", "33914-3"],
  ["2093-3", "18262-6", "2085-9", "2571-8"],
  ["718-7", "4544-3", "6690-2", "789-8", "777-3", "787-2"],
  ["2951-2", "2823-3", "2075-0", "17861-6", "3094-0", "2160-0"],
  ["1742-6", "1920-8", "6768-6", "1975-2", "1751-7"],
  ["3016-3", "3024-7", "1989-3", "2132-9"],
  ["4548-4", "2345-7", "2093-3", "18262-6", "2085-9", "2571-8", "2160-0"],
  ["718-7", "2276-4", "2132-9", "1989-3"],
];
const STYLES = ["classic", "indian", "compact"] as const;
const LABS = ["Metro Diagnostics", "Sunrise Pathology Lab", "CityCare Labs", "Apollo-style Clinical Lab", "Green Valley Hospital Lab"];

function labHtml(style: (typeof STYLES)[number], date: string, lab: string, rows: { name: string; value: string; unit: string; range: string }[]) {
  const { font, extra } = {
    classic: { font: "font-family:Georgia,serif", extra: "th{background:#eee}" },
    indian: { font: "font-family:Arial,sans-serif;font-size:13px", extra: "th{border-bottom:2px solid #000}" },
    compact: { font: "font-family:'Courier New',monospace;font-size:12px", extra: "" },
  }[style];
  const head = style === "indian" ? ["Investigation", "Result", "Units", "Bio. Ref. Interval"] : style === "compact" ? ["TEST", "RESULT", "UNIT", "REF RANGE"] : ["Test", "Value", "Unit", "Reference range"];
  const d = new Date(date);
  const shown = style === "indian" ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : style === "compact" ? date : d.toDateString();
  return `<html><body style="width:760px;padding:28px;${font}">
<style>table{border-collapse:collapse;width:100%} td,th{padding:6px 8px;text-align:left;border-bottom:1px solid #ccc} ${extra}</style>
<h2 style="margin:0">${lab}</h2><p style="color:#555;margin:2px 0 12px">NABL accredited · 24, MG Road · Ph 080-4000 1234</p>
<p><b>Patient:</b> Test Patient &nbsp; <b>Age/Sex:</b> 54 Y / F &nbsp; <b>Sample collected:</b> ${shown} &nbsp; <b>Ref. by:</b> Dr. A. Rao</p>
<table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>
${rows.map((r) => `<tr><td>${r.name}</td><td><b>${r.value}</b></td><td>${r.unit}</td><td>${r.range}</td></tr>`).join("\n")}</table>
<p style="margin-top:18px;color:#666;font-size:11px">*** End of report *** Results relate only to the sample tested.</p></body></html>`;
}

const RX = [
  ["Metformin 500 mg", "1 tablet", "twice daily after meals"],
  ["Atorvastatin 10 mg", "1 tablet", "once daily at night"],
  ["Telmisartan 40 mg", "1 tablet", "once daily morning"],
  ["Levothyroxine 50 mcg", "1 tablet", "once daily empty stomach"],
  ["Ferrous sulphate 200 mg", "1 tablet", "once daily"],
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 820, height: 600 } });
  const truth: Truth[] = [];

  for (let i = 0; i < 10; i++) {
    const date = `2026-0${1 + (i % 9)}-${String(10 + i).padStart(2, "0")}`;
    const file = `report-${String(i + 1).padStart(2, "0")}.png`;
    if (i < 8) {
      const rows = [], results = [];
      for (const code of PANELS[i]) {
        const t = TESTS.find((x) => x.codes[0] === code)!;
        const lo = t.low ?? (t.high ?? 100) * 0.4, hi = t.high ?? lo * 2.2;
        // ~30% of values out of range, like real reports
        const v = rand() < 0.3 ? hi * (1.1 + rand() * 0.5) : lo + (hi - lo) * rand();
        const dec = v >= 100 ? 0 : v >= 10 ? 1 : 2;
        const canonical = round(v, dec);
        // Sometimes print in SI units to test conversion
        const alt = t.convert && rand() < 0.35 ? Object.entries(t.convert).find(([u]) => u === "mmol/l" || u === "g/l" || u === "umol/l") : undefined;
        const shownVal = alt ? round(canonical / alt[1], 2) : canonical;
        const unit = alt ? ({ "mmol/l": "mmol/L", "g/l": "g/L", "umol/l": "µmol/L" } as Record<string, string>)[alt[0]] : t.unit;
        const conv = (x?: number) => (x == null ? undefined : alt ? round(x / alt[1], 2) : x);
        const range = t.low != null && t.high != null ? `${conv(t.low)} - ${conv(t.high)}` : t.high != null ? `< ${conv(t.high)}` : `> ${conv(t.low)}`;
        rows.push({ name: pick([t.name, ...t.aliases.slice(0, 3)]).replace(/\b\w/g, (c) => c.toUpperCase()), value: String(shownVal), unit, range });
        results.push({ code, value: alt ? round(shownVal * alt[1], 2) : canonical });
      }
      await page.setContent(labHtml(STYLES[i % 3], date, LABS[i % LABS.length], rows));
      truth.push({ file, kind: "lab_report", date, results, meds: [] });
    } else {
      const meds = [RX[i % RX.length], RX[(i + 2) % RX.length]];
      await page.setContent(`<html><body style="width:700px;padding:30px;font-family:Arial">
<h2 style="margin:0">Dr. A. Rao, MD (Medicine)</h2><p style="color:#555">Reg. No. 12345 · Sunrise Clinic</p><p>Date: ${date} &nbsp; Patient: Test Patient, 54/F</p>
<p style="font-size:28px;margin:12px 0">℞</p><ol>${meds.map((m) => `<li style="margin:8px 0"><b>${m[0]}</b> — ${m[1]}, ${m[2]} × 30 days</li>`).join("")}</ol>
<p style="margin-top:40px">Review after 1 month with HbA1c and lipid profile.</p></body></html>`);
      truth.push({ file, kind: "prescription", date, results: [], meds: meds.map((m) => m[0]) });
    }
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "truth.json"), JSON.stringify(truth, null, 2));
  console.log(`Wrote ${truth.length} reports to ${OUT}`);
}
main();
