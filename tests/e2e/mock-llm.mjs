// Stand-in for MedGemma speaking the OpenAI chat API, so E2E runs offline and deterministically.
// It answers like the real model would: extraction JSON for images, card picks for layouts, query specs for questions.
import http from "node:http";

const EXTRACTION = {
  document_type: "lab_report", report_date: "2026-09-15", lab_name: "Metro Diagnostics",
  results: [
    { name: "Glycated Hb (HbA1c)", value: 7.4, unit: "%", ref_low: 4, ref_high: 5.6 },
    { name: "Fasting Blood Sugar", value: 7.5, unit: "mmol/L", ref_low: 3.9, ref_high: 5.5 },
    { name: "LDL Cholesterol", value: "3.1", unit: "mmol/L", ref_low: null, ref_high: 2.6 },
    { name: "Serum Creatinine", value: 0.9, unit: "mg/dL", ref_low: 0.6, ref_high: 1.1 },
    { name: "Zonulin", value: 41, unit: "ng/mL", ref_low: null, ref_high: 107 },
  ],
  medications: [{ name: "Metformin 500 mg", dose: "1 tablet", frequency: "twice daily", duration: null }],
};

function reply(body) {
  const last = body.messages.at(-1);
  if (Array.isArray(last.content) && last.content.some((p) => p.type === "image_url")) return "```json\n" + JSON.stringify(EXTRACTION) + "\n```";
  const text = typeof last.content === "string" ? last.content : "";
  if (text.includes("dashboard cards")) {
    const brief = JSON.parse(text.match(/Patient data summary:\n(.*)\n/)[1]);
    const abnormal = brief.tests.filter((t) => t.flag !== "normal").slice(0, 3);
    return JSON.stringify({ cards: [
      { type: "abnormal", reason: "abnormal_latest" },
      ...abnormal.map((t) => ({ type: "trend", code: t.code, reason: "abnormal_latest" })),
      { type: "trend", code: "0000-0", reason: "rising" }, // hallucinated test: app must drop it
      { type: "meds", reason: "overview" },
      { type: "timeline", reason: "overview" },
    ] });
  }
  if (text.includes("Question:")) {
    const q = text.match(/Question: "(.*)"/)[1].toLowerCase();
    return JSON.stringify({ tests: q.includes("sugar") || q.includes("a1c") || q.includes("diabetes") ? ["4548-4", "2345-7"] : [], from: null, to: null, show_meds: true, out_of_scope: q.includes("do i have") });
  }
  return "{}";
}

const port = Number(process.env.MOCK_LLM_PORT ?? 4011);
http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) { res.writeHead(404).end(); return; }
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const content = reply(JSON.parse(data));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
}).listen(port, () => console.log(`mock llm on ${port}`));
