import { describe, it, expect } from "vitest";
import { findTest, normalizeResult, flag, medGroups, normUnit } from "@/lib/tests";

describe("test catalog", () => {
  it("matches aliases as printed on reports", () => {
    expect(findTest("Glycated Hb")?.codes[0]).toBe("4548-4");
    expect(findTest("HbA1c")?.codes[0]).toBe("4548-4");
    expect(findTest("S. Creatinine")?.codes[0]).toBe("2160-0");
    expect(findTest("Cholesterol, Total")?.codes[0]).toBe("2093-3");
    expect(findTest("LDL Cholesterol (Calculated)")?.codes[0]).toBe("18262-6");
    expect(findTest("SGPT")?.codes[0]).toBe("1742-6");
    expect(findTest("Glycated Hb (HbA1c)")?.codes[0]).toBe("4548-4");
    expect(findTest("Thyroid Stimulating Hormone (TSH)")?.codes[0]).toBe("3016-3");
    expect(findTest("Lipid profile (fasting)")).toBeUndefined();
    expect(findTest("4548-4")?.name).toBe("HbA1c");
    expect(findTest("Unobtainium level")).toBeUndefined();
  });

  it("converts units to canonical", () => {
    const g = normalizeResult("Fasting Blood Sugar", 7, "mmol/L", 3.9, 5.5);
    expect(g).toMatchObject({ code: "2345-7", unit: "mg/dL", value: 126.11, needsReview: false });
    expect(g.low).toBeCloseTo(70.26, 1);
    expect(normalizeResult("LDL", 3, "mmol/L").value).toBeCloseTo(116, 0);
    expect(normalizeResult("Hemoglobin", 135, "g/L").value).toBe(13.5);
    expect(normalizeResult("Platelet count", 2.5, "lakh/mm3").value).toBe(250);
    expect(normalizeResult("WBC", 7.2, "x10^3/µL")).toMatchObject({ value: 7.2, needsReview: false });
    expect(normalizeResult("WBC", 7.2, "K/uL")).toMatchObject({ value: 7.2, needsReview: false });
  });

  it("keeps but flags unknown units and tests", () => {
    expect(normalizeResult("HbA1c", 53, "mmol/mol")).toMatchObject({ value: 53, unit: "mmol/mol", needsReview: true });
    expect(normalizeResult("Mystery marker", 4, "U")).toMatchObject({ code: null, needsReview: true });
  });

  it("uses catalog range only when the lab gives none", () => {
    expect(normalizeResult("HbA1c", 6, "%")).toMatchObject({ low: 4, high: 5.6 });
    expect(normalizeResult("HbA1c", 6, "%", 4.5, 6.4)).toMatchObject({ low: 4.5, high: 6.4 });
  });

  it("flags against range edges", () => {
    expect(flag(5.6, 4, 5.6)).toBe("normal");
    expect(flag(5.7, 4, 5.6)).toBe("high");
    expect(flag(3.9, 4, null)).toBe("low");
    expect(flag(100, null, null)).toBe("normal");
  });

  it("links medicines to test groups", () => {
    expect(medGroups("24 HR Metformin hydrochloride 500 MG")).toContain("diabetes");
    expect(medGroups("Simvastatin 10 MG")).toContain("lipids");
    expect(medGroups("Paracetamol")).toEqual([]);
  });

  it("normalizes unit spellings", () => {
    expect(normUnit("10*3/uL")).toBe(normUnit("10^3/µL"));
    expect(normUnit("mL/min/{1.73_m2}")).toBe(normUnit("mL/min/1.73m2"));
  });
});
