import { test, expect, type Page } from "@playwright/test";

// A real 1x1 PNG; the mock model ignores pixels, but the browser must decode it.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const cards = (page: Page) => page.locator("[data-card]");

test("upload → verify → adaptive dashboard → trends → visit → ask → family", async ({ page }, info) => {
  const name = `Asha ${info.project.name}`;

  await test.step("create a profile", async () => {
    await page.goto("/profiles");
    await page.getByLabel("Name").fill(name);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByText("No results yet for this profile.")).toBeVisible();
  });

  await test.step("upload a lab report and verify extracted values", async () => {
    await page.goto("/upload");
    await page.getByTestId("file").setInputFiles({ name: "report.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: /Read 1 page/ }).click();
    const verify = page.getByTestId("verify");
    await expect(verify).toBeVisible();
    await expect(verify.getByTestId("row")).toHaveCount(5);
    // Unit conversion happened before the user sees it: 7.5 mmol/L → mg/dL
    await expect(page.getByLabel("Glucose value")).toHaveValue("135.12");
    await expect(page.getByLabel("LDL cholesterol value")).toHaveValue("119.88");
    // Unknown test is highlighted for review rather than silently dropped
    await expect(verify.getByText("Unrecognised test name")).toBeVisible();
    await expect(page.getByLabel("Report date")).toHaveValue("2026-09-15");
    await expect(page.getByLabel("Medicine name")).toHaveValue("Metformin 500 mg");

    // User corrects a misread value, then must confirm before saving
    await page.getByLabel("Serum Creatinine value").or(page.getByLabel("Creatinine value")).fill("1.4");
    const save = page.getByRole("button", { name: "Save to my records" });
    await expect(save).toBeDisabled();
    await page.getByLabel("I've checked these values").check();
    await save.click();
    await page.waitForURL("/");
  });

  await test.step("dashboard is arranged by the model, minus anything it invented", async () => {
    await expect(page.getByTestId("layout-source")).toContainText("arranged by MedGemma");
    await expect(page.locator('[data-card="trend:4548-4"]')).toBeVisible();
    await expect(page.locator('[data-card="trend:0000-0"]')).toHaveCount(0);
    await expect(cards(page).first()).toHaveAttribute("data-card", "abnormal");
    // Reason text is written by the app from the stored value
    await expect(page.locator('[data-card="trend:4548-4"]')).toContainText("Latest HbA1c (7.4 %) is higher than the reference range");
    // Corrected creatinine (1.4 > lab high 1.1) shows as out of range
    await expect(page.locator('[data-card="abnormal"]')).toContainText("Creatinine");
  });

  await test.step("pinning moves a card to the top", async () => {
    await page.locator('[data-card="meds"]').getByRole("button", { name: /Pin/ }).click();
    await expect(cards(page).first()).toHaveAttribute("data-card", "meds");
    await expect(cards(page).first()).toContainText("Pinned by you");
  });

  await test.step("simple view shows at most 4 cards", async () => {
    await page.getByRole("button", { name: "Simple large view" }).click();
    await expect(page.getByRole("button", { name: "Detailed view" })).toBeVisible();
    expect(await cards(page).count()).toBeLessThanOrEqual(4);
    await page.getByRole("button", { name: "Detailed view" }).click();
    await expect(page.getByRole("button", { name: "Simple large view" })).toBeVisible();
  });

  await test.step("trend page links back to the encrypted source document", async () => {
    await page.goto("/trends/4548-4");
    await expect(page.getByRole("heading", { name: "HbA1c" })).toBeVisible();
    const href = await page.getByRole("link", { name: "document" }).first().getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/jpeg");
  });

  await test.step("doctor-visit summary for a diabetologist", async () => {
    await page.goto("/visit?s=endocrinology");
    const v = page.getByTestId("visit-summary");
    await expect(v).toContainText("Endocrinologist");
    await expect(v).toContainText("HbA1c");
    await expect(v).toContainText("Metformin");
    await expect(v).toContainText("Not a diagnosis");
  });

  await test.step("ask your records: chart, plus refusal to diagnose", async () => {
    await page.goto("/ask");
    await page.getByLabel("Question").fill("Do I have diabetes? Show my sugar");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const a = page.getByTestId("answer");
    await expect(a).toBeVisible();
    await expect(a.getByRole("note")).toContainText("can't diagnose");
    await expect(a.getByRole("img", { name: /HbA1c trend chart/ })).toBeVisible();
    await expect(a.getByRole("img", { name: /Glucose trend chart/ })).toBeVisible();
    await expect(a).toContainText("Query chosen by MedGemma");
  });

  await test.step("demo patients get a different layout from the same app", async () => {
    await page.goto("/profiles");
    await page.getByRole("button", { name: "Reload demo patients (Synthea)" }).click();
    await page.waitForURL("/");
    await expect(page.getByLabel("Profile")).toContainText("demo: Diabetes");
    const diabetic = await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-card")).join(","));
    await page.getByLabel("Profile").selectOption({ label: await page.getByLabel("Profile").locator("option", { hasText: "demo: Anemia" }).innerText() });
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/Harris|Angelyn/);
    await expect.poll(async () => (await cards(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-card")).join(",")))).not.toBe(diabetic);
  });
});

test("no page scrolls sideways on a phone", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  for (const path of ["/", "/upload", "/ask", "/visit", "/profiles", "/plans", "/trends/4548-4"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(1);
  }
});
