import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";
import { parseCsv } from "@/lib/seed";
import { db, q, latestByTest } from "@/lib/db";
import { keywordSpec, ask } from "@/lib/ask";
import { trendData } from "@/lib/trend";
import { getLayout } from "@/lib/layout";

describe("encryption at rest", () => {
  it("round-trips and detects tampering", () => {
    const blob = encrypt(Buffer.from("HbA1c 7.2%"));
    expect(blob.includes(Buffer.from("HbA1c"))).toBe(false);
    expect(decrypt(blob).toString()).toBe("HbA1c 7.2%");
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob)).toThrow();
  });
});

describe("csv", () => {
  it("handles quoted commas and escaped quotes", () => {
    expect(parseCsv('A,B\n1,"x, ""y"""\n2,z\n')).toEqual([{ A: "1", B: 'x, "y"' }, { A: "2", B: "z" }]);
  });
});

describe("profile data (sqlite)", () => {
  const pid = Number(db().prepare("insert into profiles (name) values ('Unit')").run().lastInsertRowid);
  const ins = db().prepare("insert into results (profile_id, test_code, test_name, value, unit, ref_low, ref_high, taken_at) values (?, ?, ?, ?, ?, ?, ?, ?)");
  [["2019-06-01", 8.4], ["2019-12-01", 8.1], ["2020-06-01", 7.0], ["2020-12-01", 6.6], ["2021-06-01", 6.4]].forEach(([t, v]) => ins.run(pid, "4548-4", "HbA1c", v, "%", 4, 5.6, t));
  ins.run(pid, "18262-6", "LDL cholesterol", 150, "mg/dL", null, 100, "2021-06-01");
  ins.run(pid, "18262-6", "LDL cholesterol", 120, "mg/dL", null, 100, "2021-06-01"); // same-day tie: later row wins everywhere
  db().prepare("insert into medications (profile_id, name, start_date) values (?, ?, ?)").run(pid, "Metformin 500 MG Oral Tablet", "2020-01-15");

  it("latest value and trend agree on same-day ties", () => {
    expect(latestByTest(pid).get("18262-6")?.value).toBe(120);
    expect(trendData(pid, "18262-6")!.points.at(-1)!.v).toBe(120);
  });

  it("computes before/after averages around a medicine start", () => {
    const d = trendData(pid, "4548-4")!;
    expect(d.meds).toEqual([{ name: "Metformin", start: "2020-01-15", end: null }]);
    expect(d.effects[0]).toMatchObject({ med: "Metformin", before: 8.3, after: 6.8, nBefore: 2, nAfter: 2 });
  });

  it("keyword spec understands tests, topics and 'since I started X'", () => {
    expect(keywordSpec("how is my a1c", pid).tests).toEqual(["4548-4"]);
    expect(keywordSpec("show my cholesterol", pid).tests).toEqual(["18262-6"]);
    expect(keywordSpec("HbA1c since I started metformin", pid).from).toBe("2019-01-15");
    expect(keywordSpec("sugar since 2020", pid)).toMatchObject({ tests: ["4548-4"], from: "2020-01-01" });
  });

  it("ask without a model still answers, and refuses diagnosis", async () => {
    const a = await ask("Do I have diabetes? show my hba1c", pid);
    expect(a.source).toBe("keywords");
    expect(a.charts[0].code).toBe("4548-4");
    expect(a.notice).toMatch(/can't diagnose/);
    const none = await ask("what about my spleen", pid);
    expect(none.charts).toEqual([]);
  });

  it("layout falls back to rules without a model and caches by data version", async () => {
    const first = await getLayout(pid);
    expect(first.source).toBe("rules");
    expect(first.cards.map((c) => c.key)).toContain("trend:4548-4");
    expect((await getLayout(pid)).source).toBe("cache-rules");
    db().prepare("insert into pins (profile_id, card_key) values (?, ?)").run(pid, "timeline");
    expect((await getLayout(pid)).cards[0]).toMatchObject({ key: "timeline", pinned: true, why: "Pinned by you" });
    ins.run(pid, "4548-4", "HbA1c", 6.2, "%", 4, 5.6, "2022-01-01");
    expect((await getLayout(pid)).source).toBe("rules");
    expect(q.dataVersion(pid)).toMatch(/^8:/);
  });
});
