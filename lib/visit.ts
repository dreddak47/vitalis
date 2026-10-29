import { q, latestByTest } from "./db";
import { testByCode, flag, type Group } from "./tests";
import { shortMed } from "./layout";

export const SPECIALTIES: Record<string, { label: string; groups: Group[] }> = {
  general: { label: "General physician", groups: ["diabetes", "lipids", "kidney", "vitals", "cbc", "thyroid", "liver", "electrolytes", "vitamins", "cardiac"] },
  cardiology: { label: "Cardiologist", groups: ["lipids", "vitals", "cardiac", "diabetes", "kidney"] },
  endocrinology: { label: "Endocrinologist / diabetologist", groups: ["diabetes", "thyroid", "lipids", "vitals", "kidney"] },
  nephrology: { label: "Nephrologist (kidney)", groups: ["kidney", "electrolytes", "diabetes", "vitals", "cbc"] },
  hematology: { label: "Hematologist (blood)", groups: ["cbc", "vitamins", "liver"] },
};

/** Specialty-focused one-page summary. Purely database-driven: no model call, so it is instant and exact. */
export function visitSummary(pid: number, specialty: string) {
  const spec = SPECIALTIES[specialty] ?? SPECIALTIES.general;
  const latest = latestByTest(pid);
  const rows = [];
  for (const g of spec.groups) {
    for (const r of latest.values()) {
      const def = testByCode(r.test_code!);
      if (def?.group !== g) continue;
      const series = q.results(pid, r.test_code!);
      const prev = series.length > 1 ? series.at(-2)! : null;
      rows.push({ code: r.test_code!, group: g, name: r.test_name, value: r.value, unit: r.unit, date: r.taken_at, low: r.ref_low, high: r.ref_high, flag: flag(r.value, r.ref_low, r.ref_high), prev: prev ? { value: prev.value, date: prev.taken_at } : null, n: series.length });
    }
  }
  const other = [...latest.values()]
    .filter((r) => !spec.groups.includes(testByCode(r.test_code!)?.group as Group) && flag(r.value, r.ref_low, r.ref_high) !== "normal")
    .map((r) => ({ name: r.test_name, value: r.value, unit: r.unit, date: r.taken_at, flag: flag(r.value, r.ref_low, r.ref_high) }));
  const meds = q.meds(pid).filter((m) => !m.end_date).map((m) => ({ name: shortMed(m.name), full: m.name, dose: m.dose, since: m.start_date }));
  const stopped = q.meds(pid).filter((m) => m.end_date && Date.parse(m.end_date) > Date.now() - 365 * 864e5).map((m) => ({ name: shortMed(m.name), stopped: m.end_date }));
  return { spec, rows, other, meds, stopped };
}
export const ageOf = (dob: string | null) => (dob ? Math.floor((Date.now() - Date.parse(dob)) / 3.156e10) : null);
