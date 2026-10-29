import { z } from "zod";
import { db, q, latestByTest, type Result } from "./db";
import { testByCode, flag, medGroups, type Group } from "./tests";
import { chatJson, llmConfigured } from "./llm";

// The AI only chooses WHICH cards and WHY (from a fixed enum). All visible numbers and reason text are written here from the DB.
export const REASONS = ["abnormal_latest", "rising", "falling", "related_med", "condition_focus", "overview"] as const;
export type Reason = (typeof REASONS)[number];

export const CardSchema = z.object({
  type: z.enum(["trend", "abnormal", "latest", "meds", "timeline"]),
  code: z.string().optional(),
  group: z.string().optional(),
  reason: z.enum(REASONS),
});
export type Card = z.infer<typeof CardSchema> & { key: string; why: string; pinned?: boolean };
const LayoutSchema = z.object({ cards: z.array(CardSchema).max(12) });

// Headline test per group, used when picking a trend to show.
const LEAD: Record<Group, string[]> = {
  diabetes: ["4548-4", "2345-7"], kidney: ["33914-3", "2160-0", "14959-1"], lipids: ["18262-6", "2093-3", "2571-8", "2085-9"],
  cbc: ["718-7", "2276-4", "777-3", "6690-2"], vitals: ["8480-6", "39156-5", "29463-7"], thyroid: ["3016-3", "3024-7"],
  liver: ["1742-6", "1920-8"], electrolytes: ["2823-3", "2951-2"], cardiac: ["89579-7"], vitamins: ["1989-3", "2132-9"],
};

export type Summary = ReturnType<typeof summarize>;

export function summarize(pid: number) {
  const p = q.profile(pid);
  const latest = latestByTest(pid);
  const all = q.results(pid);
  const series = new Map<string, Result[]>();
  for (const r of all) if (r.test_code) series.set(r.test_code, [...(series.get(r.test_code) ?? []), r]);

  const tests = [...latest.values()].map((r) => {
    const s = series.get(r.test_code!)!;
    const prev = s.slice(-4, -1).map((x) => x.value);
    const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : r.value;
    const change = avg ? (r.value - avg) / Math.abs(avg) : 0;
    return {
      code: r.test_code!, name: r.test_name, group: (testByCode(r.test_code!)?.group ?? "other") as Group | "other",
      value: r.value, unit: r.unit, taken_at: r.taken_at, n: s.length,
      flag: flag(r.value, r.ref_low, r.ref_high),
      trend: s.length < 3 ? "flat" : change > 0.1 ? "rising" : change < -0.1 ? "falling" : "flat",
    };
  });
  const meds = q.meds(pid).filter((m) => !m.end_date);
  const age = p?.dob ? Math.floor((Date.now() - Date.parse(p.dob)) / 3.156e10) : null;
  return { pid, simple: p?.view_pref === "simple", age, sex: p?.sex ?? null, tests, meds, hasDocs: q.docCount(pid) > 0 };
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toString() : String(Math.round(v * 10) / 10));

/** Human-readable "why this card is here", written from real data. */
export function explain(c: z.infer<typeof CardSchema>, s: Summary): string {
  const t = c.code ? s.tests.find((x) => x.code === c.code) : undefined;
  const med = t && s.meds.find((m) => medGroups(m.name).includes(t.group as Group));
  switch (c.reason) {
    case "abnormal_latest":
      return t ? `Latest ${t.name} (${fmt(t.value)} ${t.unit}) is ${t.flag === "normal" ? "in range" : `${t.flag}er than the reference range`}` : `${s.tests.filter((x) => x.flag !== "normal").length} of your latest values are outside the reference range`;
    case "rising":
    case "falling":
      return t ? `${t.name} is ${t.trend === "flat" ? "steady" : t.trend} compared with your previous results` : "Recent change in your results";
    case "related_med":
      return t && med ? `You take ${shortMed(med.name)}, which is commonly monitored with ${t.name}` : c.type === "meds" ? `${s.meds.length} current medicines` : "Related to your current medicines";
    case "condition_focus":
      return t ? `Your records include ${t.n} ${t.name} results` : c.group ? `Your ${c.group} results` : "Based on the tests in your records";
    case "overview":
      return c.type === "timeline" ? "Your recent documents and medicine changes" : c.type === "meds" ? `${s.meds.length} current medicines` : "Overview of your latest results";
  }
}

export const shortMed = (n: string) => n.replace(/^\d+\s*HR\s*/i, "").replace(/\s+\d.*$/, "").replace(/\s*\[.*$/, "");
const keyOf = (c: z.infer<typeof CardSchema>) => [c.type, c.code ?? c.group ?? ""].filter(Boolean).join(":");

export function ruleLayout(s: Summary): z.infer<typeof CardSchema>[] {
  const cards: z.infer<typeof CardSchema>[] = [];
  const abnormal = s.tests.filter((t) => t.flag !== "normal");
  if (abnormal.length) cards.push({ type: "abnormal", reason: "abnormal_latest" });

  // Groups ranked by how many abnormal values they hold.
  const groupScore = new Map<string, number>();
  for (const t of abnormal) groupScore.set(t.group, (groupScore.get(t.group) ?? 0) + 1);
  const pick = (g: string) => (LEAD[g as Group] ?? []).find((c) => s.tests.some((t) => t.code === c && t.n >= 2));
  for (const g of [...groupScore.keys()].sort((a, b) => groupScore.get(b)! - groupScore.get(a)!)) {
    const code = (LEAD[g as Group] ?? []).find((c) => abnormal.some((t) => t.code === c)) ?? pick(g);
    if (code) cards.push({ type: "trend", code, reason: "abnormal_latest" });
  }
  for (const m of s.meds) for (const g of medGroups(m.name)) {
    const code = pick(g);
    if (code) cards.push({ type: "trend", code, reason: "related_med" });
  }
  if (s.meds.length) cards.push({ type: "meds", reason: "overview" });
  const groups = [...new Set(s.tests.map((t) => t.group))].filter((g) => g !== "other");
  for (const g of groups.slice(0, 2)) cards.push({ type: "latest", group: g, reason: "condition_focus" });
  cards.push({ type: "timeline", reason: "overview" });
  return cards;
}

/** Drop anything the model made up (unknown tests/groups), dedupe. */
export function validateCards(cards: z.infer<typeof CardSchema>[], s: Summary) {
  const codes = new Set(s.tests.map((t) => t.code));
  const groups = new Set(s.tests.map((t) => t.group));
  const seen = new Set<string>();
  return cards.filter((c) => {
    if (c.type === "trend" && (!c.code || !codes.has(c.code))) return false;
    if (c.type === "latest" && (!c.group || !groups.has(c.group as Group))) return false;
    if (c.type === "meds" && !s.meds.length) return false;
    const k = keyOf(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function aiLayout(s: Summary) {
  // No names, dates of birth or IDs leave the server — only test names, flags, trends and drug names.
  const brief = {
    age: s.age, sex: s.sex, view: s.simple ? "simple (max 4 cards, elderly or low-detail user)" : "standard",
    tests: s.tests.map((t) => ({ code: t.code, name: t.name, group: t.group, flag: t.flag, trend: t.trend, results: t.n })),
    current_medicines: s.meds.map((m) => shortMed(m.name)),
  };
  const { cards } = await chatJson(
    [
      { role: "system", content: "You arrange a personal health dashboard. You never diagnose and never output numbers or free text. Reply with JSON only." },
      {
        role: "user",
        content: `Patient data summary:\n${JSON.stringify(brief)}\n\nChoose 4-8 dashboard cards, most important first, for what this person most needs to keep an eye on (out-of-range values, worsening trends, tests linked to their medicines).
Card types: "trend" (needs "code" from the tests list), "abnormal" (all out-of-range values), "latest" (needs "group" from the tests list), "meds", "timeline".
Each card needs "reason", one of: ${REASONS.join(", ")}.
Reply exactly as {"cards":[{"type":"...","code":"...","reason":"..."}]}`,
      },
    ],
    LayoutSchema,
    { maxTokens: 600 },
  );
  return cards;
}

export async function getLayout(pid: number): Promise<{ cards: Card[]; source: "ai" | "rules" | "cache-ai" | "cache-rules" }> {
  const s = summarize(pid);
  const version = q.dataVersion(pid);
  const cached = db().prepare("select * from layouts where profile_id = ?").get(pid) as { data_version: string; json: string; source: string } | undefined;

  let base: z.infer<typeof CardSchema>[];
  let source: "ai" | "rules" | "cache-ai" | "cache-rules";
  if (cached && cached.data_version === version) {
    base = JSON.parse(cached.json);
    source = `cache-${cached.source}` as "cache-ai" | "cache-rules";
  } else {
    base = [];
    source = "rules";
    if (llmConfigured() && s.tests.length) {
      try {
        base = validateCards(await aiLayout(s), s);
        // Product promise: out-of-range values always lead, even if the model left them out (seen with MedGemma 4B).
        if (base.length && s.tests.some((t) => t.flag !== "normal") && !base.some((c) => c.type === "abnormal")) base.unshift({ type: "abnormal", reason: "abnormal_latest" });
        source = "ai";
      } catch (e) {
        console.warn("AI layout failed, using rules:", (e as Error).message);
      }
    }
    if (!base.length) { base = validateCards(ruleLayout(s), s); source = "rules"; }
    db().prepare("insert or replace into layouts (profile_id, data_version, json, source) values (?, ?, ?, ?)").run(pid, version, JSON.stringify(base), source);
  }

  // Pinned cards always lead, in the user's order; the rest follows the adaptive order.
  const pins = q.pins(pid);
  const pinned = pins.map((k) => base.find((c) => keyOf(c) === k) ?? cardFromKey(k)).filter((c): c is z.infer<typeof CardSchema> => !!c);
  let rest = base.filter((c) => !pins.includes(keyOf(c)));
  if (s.simple) rest = rest.slice(0, Math.max(0, 4 - pinned.length));
  const cards = [...pinned.map((c) => ({ ...c, pinned: true })), ...rest.map((c) => ({ ...c, pinned: false }))].filter((c) => validateCards([c], s).length);
  return { cards: cards.map((c) => ({ ...c, key: keyOf(c), why: c.pinned ? "Pinned by you" : explain(c, s) })), source };
}

function cardFromKey(k: string): z.infer<typeof CardSchema> | undefined {
  const [type, ...rest] = k.split(":");
  const arg = rest.join(":"); // custom test codes look like "x:slug"
  const parsed = CardSchema.safeParse({ type, ...(type === "trend" ? { code: arg } : type === "latest" ? { group: arg } : {}), reason: "overview" });
  return parsed.success ? parsed.data : undefined;
}
