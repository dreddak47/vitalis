# Model Choices — what to run where, and why

## Tier 3 vision model (the handwriting workhorse)

| Option | Notes |
|---|---|
| **GPT-4o** (recommended default) | Best off-the-shelf handwritten-prescription transcription in our dev testing; strong on sig codes and mixed print/cursive. JSON-mode + function calling for structured return. |
| **Claude Sonnet (vision)** | Very close second; notably careful about marking uncertain glyphs instead of guessing — which is exactly the right behavior for confidence gating. |
| **Qwen2.5-VL-7B / 72B** (self-host) | The privacy-maximal option: runs in your own VPC/on-prem (vLLM or TGI). Use when data-residency or per-page API cost dominates. 72B ≈ GPT-4o on clean handwriting; 7B needs more review-queue slack. |
| Google Gemini Flash | Cheapest adequate tier-3 fallback at scale; weaker on Indian-style cursive sig codes. |

`RemoteOcrProvider` already speaks OpenAI-compatible chat completions, so all four
work through the same code path — swap `OPENAI_BASE_URL` + `VITALIS_VISION_MODEL`.

## Tier 2 classical OCR

| Option | Notes |
|---|---|
| **Google Document AI** | Best layout preservation on lab tables (reference-range columns survive). |
| **Azure AI Document Intelligence** | Comparable accuracy; pick if already on Azure. |
| **Tesseract 5** (self-host sidecar) | Zero per-page cost; fine for clean printed scans. Wrap in a small FastAPI service so the server's `OcrProvider` interface stays unchanged. |

## Classification + extraction (text LLM)

- **GPT-4o-mini / Claude Haiku / Llama-3.1-8B-Instruct (self-host)** — extraction over
  already-transcribed text is easy; small models hit the accuracy/cost sweet spot.
- Always use structured output (JSON schema / tool call) *and* keep the zod gate.
  Structured output reduces syntax errors; the schema gate catches semantic ones.

## Handwriting pre-filter (tier short-circuit)

A tiny CNN over page thumbnails decides "looks handwritten" before burning vision-model
calls. A fine-tuned MobileNetV3 (~14 MB) is plenty; train on IAM/handwriting-vs-print
splits. Precision matters more than recall — a false negative just pays for tier 2 first.

## Evaluation methodology

`npm run eval` scores **field-level accuracy**: each gold-labeled field earns

- `1.0` exact match (normalized: case/whitespace/unit-punctuation insensitive), or
- `0.5` field present but value wrong, or
- `0.0` field missing.

`accuracy = earned / gold_fields`, reported per document kind and overall, plus
classification accuracy (stage 2a: did the agent pick the right document kind).
Weight *all* fields equally (dose errors matter as much as name errors in
medication safety).

The bundled corpus (`apps/server/src/eval/fixtures/`) has 16 synthetic documents /
137 gold fields across all 7 document kinds, including 2 handwriting-style
prescriptions to exercise low-confidence gating. The harness is provider-agnostic:
it uses `createLlmClient(config)`, so `LLM_PROVIDER=mock` (default) exercises
harness plumbing only — MockLlmClient can't read text, so it scores near-0% by
design — and `LLM_PROVIDER=openai` against a real endpoint (OpenAI, or NVIDIA NIM
per `docs/DEMO_SETUP.md` Mode B) produces the number worth citing. Every run is
written to `fixtures/results/<timestamp>_<model>.json` with per-kind and per-field
detail; that's the artifact trail behind any accuracy figure quoted elsewhere
(e.g. a resume line). To grow the claim past a synthetic-demo footnote: add more
labeled documents per kind (target 25+ per kind, per `docs/IMPROVEMENTS.md`), pin
the model in the artifact filename, and keep re-running as prompts/models change.

## Prompt-hygiene rules baked in

- Transcription prompts say "transcribe, don't interpret"; extraction prompts say
  "never guess illegible values — lower the confidence instead."
- `temperature: 0` everywhere in the pipeline.
- Per-field `evidence` quotes are required — they make the review queue fast and make
  eval debugging possible.
