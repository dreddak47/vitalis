# Vitalis — Demo Setup Guide

Everything needed to run, present and extend the Vitalis demo.
All demo data is synthetic — no real PHI.

---

## 1. Prerequisites

- Node.js ≥ 20 (repo developed on Node 23)
- npm
- (Optional, for realistic mode) a free NVIDIA NIM API key from
  https://build.nvidia.com — click any model → "Get API Key" (starts with `nvapi-`)

Install once:

```bash
npm install
```

> **Note:** the `.env` file is loaded automatically by the dev server
> (`tsx --env-file-if-exists=../../.env`). No exports needed.

---

## 2. Kill any running processes

Ports `8787` (server) and `5173` (web) must be free. To stop everything:

```bash
pkill -f "tsx watch"   # server
pkill -f vite          # web
lsof -i :8787 -i :5173 # should print nothing
```

Or kill specific PIDs: `lsof -i :8787` → `kill <PID>`.

---

## 3. Run the demo (two modes)

### Mode A — Offline / deterministic (default, no keys)

```bash
npm run dev:server   # http://localhost:8787  (seeds the demo patient)
npm run dev:web      # http://localhost:5173
```

The mock pipeline parses the bundled fixture documents via a deterministic
contract, so behavior is 100% reproducible and works on a plane.

### Mode B — Realistic (NVIDIA NIM, free tier)

1. Edit `.env` in the repo root:
   ```ini
   LLM_PROVIDER=openai
   OCR_PROVIDER=openai
   OPENAI_API_KEY=nvapi-xxxxxxxx      # your key from build.nvidia.com
   OPENAI_BASE_URL=https://integrate.api.nvidia.com/v1
   VITALIS_TEXT_MODEL=meta/llama-3.3-70b-instruct
   VITALIS_VISION_MODEL=mistralai/mistral-small-3.1-24b-instruct-2503
   ```
2. Restart the server (`pkill -f "tsx watch"` then `npm run dev:server`).
3. The startup line shows `llm=openai ocr=openai` when active.

Model notes:
- Any model on https://build.nvidia.com/models that exposes the
  OpenAI-compatible `/chat/completions` endpoint works.
- Extraction requests use JSON-schema structured output — prefer recent
  Llama / Mistral / Nemotron chat models; if a model rejects
  `response_format`, pick another from the catalog.
- Vision model is only called for documents flagged `looksHandwritten`
  (images/scans). Plain text uploads never touch the vision model.

---

## 4. Demo walkthrough (suggested script)

Persona in the seed: **54-year-old male with type 2 diabetes + hypertension**.

1. **Documents** tab — 4 documents are pre-seeded (diagnosis note,
   prescription, lab panel, handwritten Rx). Show the review status badges.
2. **Medications** tab — point out `unverified` pills, then click
   **Confirm** on a few. The pill flips to `human verified` and the source
   document graduates to *processed* when fully reviewed.
3. **Upload new documents** — use the files in `demo/materials/`:
   | File | Upload via | Story beat |
   |---|---|---|
   | `discharge-summary.txt` | Documents → Upload (kind: discharge summary) | Adds Glimepiride, a **new sulfa allergy**, discharge vitals |
   | `lab-report-april.txt` | Documents → Upload (kind: lab report) | HbA1c 7.8% ↑, microalbumin flagged HIGH |
   | `voice-memo-transcript.txt` | Upload as text | Self-reported dizziness + foot burning (lower confidence) |
   | `prescription-followup.txt` | Documents → Upload (kind: prescription) | Dose reduction + Pregabalin added |
4. **Medications** — confirm the newly extracted meds (Glimepiride shows a
   lower verification tier until confirmed).
5. **Report** tab — click **Generate report**. The section layout adapts to
   persona (age band, `diabetic`, `hypertensive` focus). Then
   **Download (HTML)** for a self-contained printable report.
6. **Settings** — toggle display preferences (detail level, focus areas,
   trends) and regenerate the report: same data, different layout —
   that's the "generative report" pitch.
7. **Settings → Export** downloads every document, fact and report as JSON;
   **Delete everything** resets the demo (restarting the server reseeds).

---

## 5. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Confirm" button does nothing | Fixed in `apps/web/src/api.ts` — the client no longer sends `content-type: application/json` on empty-body POSTs (Fastify rejected those with `FST_ERR_CTP_EMPTY_JSON_BODY`). Same fix cured "Generate report". |
| Generate report → `400 FST_ERR_CTP_EMPTY_JSON_BODY` | Same as above — pull the fixed `api.ts`. |
| Generate report → extraction/JSON errors with `LLM_PROVIDER=openai` | The chosen NIM model rejected structured output; pick another model from build.nvidia.com and restart. |
| `EADDRINUSE :8787` / `:5173` | Old process still running — see §2. |
| Everything is empty after restart | Memory store is ephemeral by design; restart re-seeds automatically. |
| Server ignores `.env` | You're launching the server manually; `npm run dev:server` passes `--env-file-if-exists=../../.env`. |

## 6. Optional checks

```bash
npm test         # pipeline + compiler unit tests (10)
npm run eval     # extraction accuracy vs gold fixtures
npm run typecheck
```
