import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { db, DATA_DIR } from "./db";
import { testByCode, canonicalCode } from "./tests";

// Synthea (synthetichealth.github.io) — open synthetic EHR data with LOINC labs and RxNorm meds.
const URL = "https://synthetichealth.github.io/synthea-sample-data/downloads/latest/synthea_sample_data_csv_latest.zip";
const DIR = path.join(DATA_DIR, "synthea");

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

function ensureDataset() {
  if (fs.existsSync(path.join(DIR, "observations.csv"))) return;
  fs.mkdirSync(DIR, { recursive: true });
  const zip = path.join(DIR, "synthea.zip");
  execFileSync("curl", ["-sSfL", "-o", zip, URL]);
  execFileSync("unzip", ["-oqj", zip, "-d", DIR]);
  fs.rmSync(zip);
}

const read = (f: string) => parseCsv(fs.readFileSync(path.join(DIR, f), "utf8"));
const clean = (s: string) => s.replace(/\d+/g, "");
const day = (s: string) => s.slice(0, 10);

type Persona = { label: string; has: RegExp; not?: RegExp };
const PERSONAS: Persona[] = [
  { label: "Diabetes", has: /Diabetes mellitus type 2/ },
  { label: "Heart", has: /Ischemic heart disease|Myocardial infarction|Hyperlipidemia/, not: /Diabetes mellitus type 2/ },
  { label: "Anemia", has: /Anemia \(disorder\)/ },
];

export function seedDemo(): { profiles: number; results: number; meds: number } {
  ensureDataset();
  const patients = read("patients.csv");
  const conditions = read("conditions.csv");
  const observations = read("observations.csv");
  const medications = read("medications.csv");

  const condBy = new Map<string, string[]>();
  for (const c of conditions) condBy.set(c.PATIENT, [...(condBy.get(c.PATIENT) ?? []), c.DESCRIPTION]);
  const known = observations.filter((o) => o.TYPE === "numeric" && testByCode(o.CODE));
  const labCount = new Map<string, number>();
  for (const o of known) labCount.set(o.PATIENT, (labCount.get(o.PATIENT) ?? 0) + 1);

  const d = db();
  d.exec("delete from profiles where demo_source is not null");
  const picked = new Set<string>();
  let nResults = 0, nMeds = 0;

  for (const p of PERSONAS) {
    const cand = patients
      .filter((pt) => !pt.DEATHDATE && pt.BIRTHDATE > "1940" && !picked.has(pt.Id))
      .filter((pt) => (condBy.get(pt.Id) ?? []).some((c) => p.has.test(c)) && !(p.not && (condBy.get(pt.Id) ?? []).some((c) => p.not!.test(c))))
      .sort((a, b) => (labCount.get(b.Id) ?? 0) - (labCount.get(a.Id) ?? 0))[0];
    if (!cand) continue;
    picked.add(cand.Id);

    const name = `${clean(cand.FIRST)} ${clean(cand.LAST)} (demo: ${p.label})`;
    const pid = Number(d.prepare("insert into profiles (name, dob, sex, demo_source) values (?, ?, ?, ?)").run(name, cand.BIRTHDATE, cand.GENDER, cand.Id).lastInsertRowid);

    // Last 12 years is plenty for trends and keeps the DB small.
    const cutoff = `${new Date().getFullYear() - 12}`;
    const ins = d.prepare("insert into results (profile_id, test_code, test_name, value, unit, ref_low, ref_high, taken_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
    d.exec("begin");
    for (const o of known) {
      if (o.PATIENT !== cand.Id || o.DATE < cutoff) continue;
      const t = testByCode(o.CODE)!;
      ins.run(pid, canonicalCode(o.CODE), t.name, Number(o.VALUE), t.unit, t.low ?? null, t.high ?? null, day(o.DATE));
      nResults++;
    }
    // Synthea repeats a prescription per renewal; collapse to one row per drug spanning first start to last stop.
    const meds = new Map<string, { start: string; stop: string | null; ongoing: boolean }>();
    for (const m of medications) {
      if (m.PATIENT !== cand.Id) continue;
      const cur = meds.get(m.DESCRIPTION);
      const stop = m.STOP ? day(m.STOP) : null;
      if (!cur) meds.set(m.DESCRIPTION, { start: day(m.START), stop, ongoing: !stop });
      else {
        cur.start = cur.start < day(m.START) ? cur.start : day(m.START);
        cur.ongoing ||= !stop;
        if (stop && (!cur.stop || stop > cur.stop)) cur.stop = stop;
      }
    }
    const insM = d.prepare("insert into medications (profile_id, name, dose, start_date, end_date) values (?, ?, ?, ?, ?)");
    for (const [desc, m] of meds) {
      const days = m.stop ? (Date.parse(m.stop) - Date.parse(m.start)) / 864e5 : Infinity;
      if (!m.ongoing && days < 30) continue; // drop short courses (painkillers, antibiotics)
      insM.run(pid, desc, desc.match(/\d+(\.\d+)?\s?(MG|UNT|ML|MCG)\b/i)?.[0] ?? null, m.start, m.ongoing ? null : m.stop);
      nMeds++;
    }
    d.exec("commit");
  }
  return { profiles: picked.size, results: nResults, meds: nMeds };
}
