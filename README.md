# Vitalis: your health records, arranged for you

Upload a lab report or prescription (photo or PDF). **MedGemma** reads it, you confirm the values, and the dashboard **rearranges itself** around your health: out-of-range values first, trends for tests linked to your medicines, and a simpler large-text view for elderly family members.

**Core rule: the AI arranges, it never writes numbers.** The model chooses *which* cards to show and *why* (from a fixed list of reasons). Every value, chart point and explanation is read from the database by plain code. Anything the model invents (an unknown test, an unknown card) is dropped.

## Features

| | |
|---|---|
| **Upload → verify** | Photo/PDF → MedGemma extraction → unit conversion (mmol/L→mg/dL, µmol/L, g/L, lakh/mm³…) → side-by-side check with the original. Doubtful rows are highlighted, and nothing is saved until the user confirms. |
| **Adaptive home** | MedGemma picks and orders cards. Each shows a "why shown" line. Pinned cards stay on top. The layout only changes when new data arrives. Falls back to built-in rules if no model is available. |
| **Medicine ↔ result linking** | Trend charts mark when medicines started/stopped, plus an average of the year before vs. the year after. |
| **Doctor-visit mode** | One-page, specialist-specific summary (cardio, endo, kidney, blood, general), printable as a PDF. No model call, so it's instant and exact. |
| **Ask your records** | "Has my LDL improved since I started atorvastatin?" → a chart. Refuses diagnosis/dosing questions. Works without a model via keyword matching. |
| **Family profiles** | Separate dashboards for parents/kids, per-person simple view. Plans page (Free / Pro / Family) is display-only. |
| **Privacy** | Documents encrypted at rest (AES-256-GCM). No names or birth dates are sent to the model, and no health data is logged. |

## Run it

```bash
npm install
npm run dev            # http://localhost:3000 → "Load demo patients"
```

Demo patients come from **[Synthea](https://synthetichealth.github.io/synthea/)**, the standard open synthetic EHR dataset (LOINC labs, RxNorm medicines). The app downloads the ~5 MB sample on first "Load demo" (or run `npm run seed`). It picks a diabetic, a heart patient and an anemia patient with years of history.

## Connect MedGemma

The app talks to any **OpenAI-compatible** `/v1/chat/completions` server, so switching between cloud and local only means changing three env vars in `.env.local`:

```
LLM_BASE_URL=...
LLM_API_KEY=...
LLM_MODEL=...
```

**Local (recommended for privacy, free).** MedGemma 4B runs well on an Apple-silicon laptop:
```bash
brew install llama.cpp
llama-server -hf unsloth/medgemma-4b-it-GGUF:Q4_K_M --port 8081 -c 8192
# .env.local
LLM_BASE_URL=http://localhost:8081/v1
LLM_MODEL=medgemma
```
Measured with `npm run eval` on an Apple-silicon Mac (Oct 2026): 10/10 reports, 100% of tests recognised, values exact, in/out-of-range flags right, medicines and dates right, 10–50 s per page. Reaching that took three code-side guards for things MedGemma 4B got wrong: one-letter name typos ("HBac") are matched only when unique and the unit fits, a future date gets its day and month swapped back, and ranges are copied as printed text ("< 150") and parsed by code. On a dashboard, if the model leaves out the out-of-range card, the app adds it first.

Phones and tablets on the same Wi-Fi can use the app at `http://<laptop-ip>:3000`, so health data never leaves the house. (Ollama works the same way: `ollama run hf.co/unsloth/medgemma-4b-it-GGUF:Q4_K_M`, `LLM_BASE_URL=http://localhost:11434/v1`.)

**Hugging Face (cloud).** MedGemma is **not** on HF's free serverless router (checked Oct 2026), so it needs a dedicated **Inference Endpoint**:
1. Accept the license at https://huggingface.co/google/medgemma-4b-it
2. Deploy it as an Inference Endpoint (vLLM or TGI, 1× L4 GPU is enough; set scale-to-zero).
3. `.env.local`: `LLM_BASE_URL=https://<your-endpoint>.endpoints.huggingface.cloud/v1`, `LLM_API_KEY=hf_...`, `LLM_MODEL=google/medgemma-4b-it`

For quick UI testing only, the free router's `google/gemma-3-4b-it` (same family, not medically tuned) also works: `LLM_BASE_URL=https://router.huggingface.co/v1`.

Optional: `VITALIS_KEY` (64 hex chars) for the document encryption key; otherwise one is generated in `data/.key`. `VITALIS_DATA_DIR` moves the database and files.

## Tests

```bash
npm test               # unit: catalog/units, extraction parsing, layout guards, encryption, SQL, ask
npm run test:e2e       # Playwright, desktop + phone, against a mock MedGemma (offline, deterministic)
npm run reports        # render 10 lab reports/prescriptions with known values → data/reports
npm run eval           # live MedGemma accuracy on those reports (needs a configured model)
```

## Layout

```
lib/tests.ts     test catalog: LOINC codes, aliases, units, conversions, reference ranges
lib/extract.ts   MedGemma prompt + schema → normalized rows flagged for review
lib/layout.ts    adaptive dashboard: summary → model picks cards → validation → rule fallback → cache
lib/trend.ts     series + medicine markers + before/after averages
lib/ask.ts       question → query spec (model or keywords) → charts
lib/visit.ts     specialist summaries
lib/llm.ts       one OpenAI-compatible client
lib/db.ts        SQLite (built into Node), schema and queries
app/             pages + API routes
```

## Business notes

- **Who pays:** caregivers managing parents' records (Family plan), and people with chronic conditions (diabetes, thyroid, kidney, heart) who get tested every 3 months (Pro).
- **Wedge:** doctor-visit summaries and medicine-to-result charts. Plain storage apps don't link prescriptions to lab trends.
- **Before launch:** real auth, cloud sync with per-user encryption, payments (Razorpay/Stripe), consent and data-deletion flows under DPDP Act (India) / HIPAA / GDPR, and ABDM/ABHA record import. Keep the product informational (no diagnosis) to stay outside medical-device rules.

> Not a medical device. Vitalis organizes and visualizes records and does not diagnose.
