import { z } from "zod";
import { latestByTest, q } from "./db";
import { findTest, TESTS } from "./tests";
import { chatJson, llmConfigured } from "./llm";
import { trendData, type TrendData } from "./trend";
import { shortMed } from "./layout";

// The model turns a question into a QUERY SPEC (which tests, which dates). The app fetches and draws the numbers.
const SpecSchema = z.object({
  tests: z.array(z.string()).max(4),
  from: z.string().nullish(),
  to: z.string().nullish(),
  show_meds: z.boolean().default(true),
  out_of_scope: z.boolean().default(false),
});
type Spec = z.infer<typeof SpecSchema>;

export type Answer = { charts: TrendData[]; caption: string; notice: string | null; source: "ai" | "keywords" };

const ADVICE = /\b(diagnos\w*|do i have|should i (take|stop|start|increase|reduce)|dosage|dose of|cure|is (it|this) (serious|cancer|dangerous)|what disease)\b/i;
const NOTICE = "I can show what your records contain, but I can't diagnose or advise on treatment. Please discuss this with your doctor.";
const isDate = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

export function keywordSpec(question: string, pid: number): Spec {
  const qn = ` ${question.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  const have = latestByTest(pid);
  const tests = TESTS.filter((t) => have.has(t.codes[0]) && [t.name, ...t.aliases].some((a) => a.length > 2 && qn.includes(` ${a.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `))).map((t) => t.codes[0]);
  // Topic words → groups ("sugar", "kidney", "cholesterol"...)
  const topics: [RegExp, string[]][] = [[/sugar|diabet/, ["4548-4", "2345-7"]], [/kidney|renal/, ["33914-3", "2160-0"]], [/cholesterol|lipid|statin/, ["18262-6", "2093-3"]], [/blood pressure|\bbp\b/, ["8480-6", "8462-4"]], [/thyroid/, ["3016-3"]], [/anemi|anaemi|iron/, ["718-7", "2276-4"]], [/weight/, ["29463-7"]], [/liver/, ["1742-6", "1920-8"]]];
  for (const [re, codes] of topics) if (re.test(qn)) tests.push(...codes.filter((c) => have.has(c)));
  const since = qn.match(/since (\d{4})/)?.[1];
  let from = since ? `${since}-01-01` : null;
  // "since I started metformin" → one year before the start, so the before/after is visible
  const started = qn.match(/(?:started|starting|began|on) ([a-z]+)/)?.[1];
  const med = started ? q.meds(pid).find((m) => m.name.toLowerCase().includes(started)) : undefined;
  if (med?.start_date) from = new Date(Date.parse(med.start_date) - 365 * 864e5).toISOString().slice(0, 10);
  return { tests: [...new Set(tests)].slice(0, 4), from, to: null, show_meds: true, out_of_scope: ADVICE.test(question) };
}

async function aiSpec(question: string, pid: number): Promise<Spec> {
  const have = [...latestByTest(pid).values()].map((r) => ({ code: r.test_code, name: r.test_name }));
  const meds = q.meds(pid).map((m) => ({ name: shortMed(m.name), started: m.start_date, stopped: m.end_date }));
  return chatJson(
    [
      { role: "system", content: "You turn questions about a person's own health records into a chart query. Never diagnose or give medical advice. Reply with JSON only." },
      {
        role: "user",
        content: `Available tests: ${JSON.stringify(have)}\nMedicines: ${JSON.stringify(meds)}\nToday: ${new Date().toISOString().slice(0, 10)}\nQuestion: "${question}"\n
Reply as {"tests":["<codes from the list, max 4>"],"from":"YYYY-MM-DD or null","to":"YYYY-MM-DD or null","show_meds":true|false,"out_of_scope":true if the question asks for a diagnosis, treatment or dosing advice}`,
      },
    ],
    SpecSchema,
    { maxTokens: 300 },
  );
}

export async function ask(question: string, pid: number): Promise<Answer> {
  let spec: Spec | undefined;
  let source: Answer["source"] = "keywords";
  if (llmConfigured()) {
    try { spec = await aiSpec(question, pid); source = "ai"; } catch (e) { console.warn("AI ask failed, using keywords:", (e as Error).message); }
  }
  const kw = keywordSpec(question, pid);
  if (!spec || !spec.tests.length) { spec = kw; source = "keywords"; }
  const have = latestByTest(pid);
  // Accept codes or names from the model, but only tests this person actually has.
  const codes = spec.tests.map((t) => (have.has(t) ? t : findTest(t)?.codes[0])).filter((c): c is string => !!c && have.has(c));
  const charts = [...new Set(codes)].map((c) => trendData(pid, c, { from: isDate(spec!.from), to: isDate(spec!.to) })).filter((d): d is TrendData => !!d && d.points.length > 0);
  if (!spec.show_meds) charts.forEach((c) => { c.meds = []; c.effects = []; });

  const notice = spec.out_of_scope || kw.out_of_scope ? NOTICE : null;
  if (!charts.length) return { charts, caption: "I couldn't find matching results in your records. Try naming a test, e.g. “HbA1c since 2020”.", notice, source };
  const span = (d: TrendData) => `${d.points[0].t.slice(0, 4)}–${d.points.at(-1)!.t.slice(0, 4)}`;
  const caption = charts.map((d) => `${d.name}: ${d.points.length} results (${span(d)})${d.meds.length ? `, with ${d.meds.length} related medicine change${d.meds.length > 1 ? "s" : ""} marked` : ""}`).join(" · ");
  return { charts, caption, notice, source };
}
