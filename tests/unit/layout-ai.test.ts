import { describe, it, expect, vi } from "vitest";

// MedGemma 4B sometimes returns only trend cards; the out-of-range card must still lead.
vi.mock("@/lib/llm", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm")>()),
  llmConfigured: () => true,
  chatJson: async () => ({ cards: [{ type: "trend", code: "18262-6", reason: "rising" }] }),
}));

const { db } = await import("@/lib/db");
const { getLayout } = await import("@/lib/layout");

describe("AI layout guard", () => {
  it("puts the abnormal card first when the model leaves it out", async () => {
    const pid = Number(db().prepare("insert into profiles (name) values ('Guard')").run().lastInsertRowid);
    db().prepare("insert into results (profile_id, test_code, test_name, value, unit, ref_low, ref_high, taken_at) values (?, '18262-6', 'LDL cholesterol', 160, 'mg/dL', null, 100, '2026-01-01')").run(pid);
    const { cards, source } = await getLayout(pid);
    expect(source).toBe("ai");
    expect(cards.map((c) => c.key)).toEqual(["abnormal", "trend:18262-6"]);
  });
});
