import { describe, it, expect } from "vitest";
import { ruleLayout, validateCards, explain, type Summary } from "@/lib/layout";

const summary: Summary = {
  pid: 1, simple: false, age: 60, sex: "F", hasDocs: false,
  tests: [
    { code: "4548-4", name: "HbA1c", group: "diabetes", value: 8.1, unit: "%", taken_at: "2026-01-01", n: 5, flag: "high", trend: "rising" },
    { code: "2345-7", name: "Glucose", group: "diabetes", value: 90, unit: "mg/dL", taken_at: "2026-01-01", n: 5, flag: "normal", trend: "flat" },
    { code: "18262-6", name: "LDL cholesterol", group: "lipids", value: 90, unit: "mg/dL", taken_at: "2026-01-01", n: 3, flag: "normal", trend: "falling" },
  ],
  meds: [{ id: 1, profile_id: 1, document_id: null, name: "Simvastatin 10 MG Oral Tablet", dose: "10 MG", frequency: null, start_date: "2020-01-01", end_date: null }],
};

describe("adaptive layout", () => {
  it("rule layout leads with abnormal values and their trend, then medicine-linked tests", () => {
    const cards = ruleLayout(summary);
    expect(cards[0]).toMatchObject({ type: "abnormal" });
    expect(cards[1]).toMatchObject({ type: "trend", code: "4548-4" });
    expect(cards).toContainEqual({ type: "trend", code: "18262-6", reason: "related_med" });
    expect(cards.at(-1)).toMatchObject({ type: "timeline" });
  });

  it("drops cards the model invented and duplicates", () => {
    const out = validateCards([
      { type: "trend", code: "4548-4", reason: "abnormal_latest" },
      { type: "trend", code: "4548-4", reason: "rising" },
      { type: "trend", code: "3016-3", reason: "condition_focus" }, // TSH: person has no TSH results
      { type: "trend", reason: "overview" },
      { type: "latest", group: "thyroid", reason: "overview" },
      { type: "latest", group: "lipids", reason: "overview" },
    ], summary);
    expect(out.map((c) => c.type + (c.code ?? c.group ?? ""))).toEqual(["trend4548-4", "latestlipids"]);
  });

  it("drops a meds card when there are no current medicines", () => {
    expect(validateCards([{ type: "meds", reason: "overview" }], { ...summary, meds: [] })).toEqual([]);
  });

  it("writes the visible reason from real data, not from the model", () => {
    expect(explain({ type: "trend", code: "4548-4", reason: "abnormal_latest" }, summary)).toBe("Latest HbA1c (8.1 %) is higher than the reference range");
    expect(explain({ type: "trend", code: "18262-6", reason: "related_med" }, summary)).toBe("You take Simvastatin, which is commonly monitored with LDL cholesterol");
    expect(explain({ type: "trend", code: "18262-6", reason: "rising" }, summary)).toBe("LDL cholesterol is falling compared with your previous results");
  });
});
