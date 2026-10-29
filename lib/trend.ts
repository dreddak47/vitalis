import { q } from "./db";
import { testByCode, medGroups } from "./tests";
import { shortMed } from "./layout";

export type TrendData = {
  code: string; name: string; unit: string; low: number | null; high: number | null;
  points: { t: string; v: number }[];
  meds: { name: string; start: string; end: string | null }[];
  effects: { med: string; start: string; before: number; after: number; nBefore: number; nAfter: number }[];
};

const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
const YEAR = 365 * 864e5;

/** Series for one test plus related medicines and a simple before/after comparison around each medicine start. */
export function trendData(pid: number, code: string, opts: { from?: string | null; to?: string | null; allMeds?: boolean } = {}): TrendData | null {
  let rows = q.results(pid, code);
  if (!rows.length) return null;
  if (opts.from) rows = rows.filter((r) => r.taken_at >= opts.from!);
  if (opts.to) rows = rows.filter((r) => r.taken_at <= opts.to!);
  const def = testByCode(code);
  const last = rows.at(-1) ?? q.results(pid, code).at(-1)!;
  const points = rows.map((r) => ({ t: r.taken_at, v: r.value }));
  const first = points[0]?.t ?? "", end = points.at(-1)?.t ?? "";

  const related = q.meds(pid).filter((m) => m.start_date && (opts.allMeds || (def && medGroups(m.name).includes(def.group))));
  const meds = related
    .filter((m) => m.start_date! <= end && (!m.end_date || m.end_date >= first))
    .map((m) => ({ name: shortMed(m.name), start: m.start_date!, end: m.end_date }));

  const effects = meds.flatMap((m) => {
    const s = Date.parse(m.start);
    const before = points.filter((p) => Date.parse(p.t) < s && Date.parse(p.t) >= s - YEAR).map((p) => p.v);
    // skip the first month: most medicines take weeks to show an effect on labs
    const after = points.filter((p) => Date.parse(p.t) > s + 30 * 864e5 && Date.parse(p.t) <= s + YEAR).map((p) => p.v);
    return before.length && after.length ? [{ med: m.name, start: m.start, before: avg(before), after: avg(after), nBefore: before.length, nAfter: after.length }] : [];
  });

  return { code, name: last.test_name, unit: last.unit, low: last.ref_low, high: last.ref_high, points, meds, effects };
}
