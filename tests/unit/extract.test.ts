import { describe, it, expect, vi } from "vitest";
import { parseJson, LLMError } from "@/lib/llm";
import { ExtractSchema, toRows, customCode, parseRange } from "@/lib/extract";

describe("model JSON parsing", () => {
  it("handles fences, prose and arrays", () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Here you go: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
    expect(parseJson("[1,2]")).toEqual([1, 2]);
  });
  it("throws LLMError on junk", () => {
    expect(() => parseJson("no json here")).toThrow(LLMError);
    expect(() => parseJson('{"a":')).toThrow(LLMError);
  });
});

describe("extraction → rows", () => {
  const raw = {
    document_type: "lab_report", report_date: "2026-03-14", lab_name: "City Lab",
    results: [
      { name: "Glycated Hb", value: "7.2", unit: "%", ref_low: 4, ref_high: 5.6 },
      { name: "Fasting glucose", value: 7.5, unit: "mmol/L" },
      { name: "Urine ketones", value: "Negative", unit: "" },
      { name: "Microalbumin", value: "<5", unit: "mg/g", ref_high: 30 },
      { name: "Blorbium", value: 3, unit: "U" },
      { name: "HbA1c", value: 53, unit: "mmol/mol" },
      { name: "Platelets", value: 250000, unit: "10^3/uL" },
    ],
    medications: [{ name: "Metformin 500 mg", dose: "1 tab", frequency: "twice daily", duration: "30 days" }],
  };

  it("normalizes, drops qualitative values and flags doubtful rows", () => {
    const out = toRows(ExtractSchema.parse(raw));
    expect(out.date).toBe("2026-03-14");
    expect(out.lab).toBe("City Lab");
    const by = Object.fromEntries(out.rows.map((r) => [r.name + "|" + r.unit, r]));
    expect(by["HbA1c|%"]).toMatchObject({ code: "4548-4", value: 7.2, review: null });
    expect(by["Glucose|mg/dL"].value).toBeCloseTo(135.1, 1);
    expect(out.rows.find((r) => r.name === "Urine albumin/creatinine")?.value).toBe(5);
    expect(out.rows.some((r) => r.name === "Urine ketones")).toBe(false);
    expect(out.rows.find((r) => r.name === "Blorbium")?.review).toMatch(/Unrecognised/);
    expect(out.rows.find((r) => r.unit === "mmol/mol")?.review).toMatch(/Unit/);
    expect(out.rows.find((r) => r.name === "Platelets")?.review).toMatch(/Unusually high/);
    expect(out.meds[0]).toEqual({ name: "Metformin 500 mg", dose: "1 tab", frequency: "twice daily, 30 days" });
  });

  it("rejects a bad date and tolerates missing arrays", () => {
    const out = toRows(ExtractSchema.parse({ report_date: "14/03/2026" }));
    expect(out).toEqual({ rows: [], meds: [], date: null, lab: null });
  });

  it("makes stable custom codes", () => {
    expect(customCode("Vitamin K2 (MK-7)")).toBe("x:vitamin-k2-mk-7");
  });
});

describe("misread fixes (seen with real MedGemma)", () => {
  const rows = (results: object[], report_date = "2026-03-14") => toRows(ExtractSchema.parse({ document_type: "lab_report", report_date, results, medications: [] }));

  it("matches one-letter typos only when unique and the unit fits, and still asks for review", () => {
    const out = rows([
      { name: "HBac", value: 7.4, unit: "%" },
      { name: "Egr", value: 90, unit: "mL/min/1.73m2" },
      { name: "XDL", value: 50, unit: "mg/dL" }, // one edit from both LDL and HDL → no guess
      { name: "HBac", value: 7.4, unit: "mg/dL" }, // unit doesn't fit HbA1c → no guess
    ]);
    expect(out.rows.map((r) => r.code)).toEqual(["4548-4", "33914-3", null, null]);
    expect(out.rows[0].review).toMatch(/matched to HbA1c/);
  });

  it("treats a collapsed range (low = high) as an upper limit only", () => {
    const out = rows([{ name: "Triglycerides", value: 102, unit: "mg/dL", ref_low: 150, ref_high: 150 }]);
    expect(out.rows[0]).toMatchObject({ ref_high: 150 });
    expect(out.rows[0].ref_low ?? null).toBeNull();
  });

  it("reads printed range text, so < and > can't land on the wrong side", () => {
    expect(parseRange("4.0 - 5.6")).toEqual({ low: 4, high: 5.6 });
    expect(parseRange("70–100 mg/dL")).toEqual({ low: 70, high: 100 });
    expect(parseRange("< 150")).toEqual({ low: null, high: 150 });
    expect(parseRange("> 60")).toEqual({ low: 60, high: null });
    expect(parseRange("1,50,000 - 4,50,000")).toEqual({ low: 150000, high: 450000 });
    expect(parseRange("see note")).toBeNull();
    const out = rows([{ name: "eGFR", value: 125, unit: "mL/min/1.73m2", ref_range: "> 60", ref_low: 60, ref_high: 60 }]);
    expect(out.rows[0]).toMatchObject({ ref_low: 60 });
    expect(out.rows[0].ref_high ?? null).toBeNull();
  });

  it("swaps day/month when a date was read in the future", () => {
    vi.useFakeTimers({ now: new Date("2026-10-29") });
    expect(rows([], "2026-11-02").date).toBe("2026-02-11");
    expect(rows([], "2026-03-14").date).toBe("2026-03-14");
    vi.useRealTimers();
  });
});
