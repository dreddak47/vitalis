# Vitalis

**Privacy-first personal health records, compiled into reports that fit *you*.**

Vitalis ingests hospital reports, doctor notes, scanned/handwritten prescriptions and
voice-memo transcripts; extracts structured, confidence-scored medical facts with
domain-aware AI agents; and compiles a **generative health report** — a section-by-section
layout computed from your records, your age, your conditions and your display
preferences, not a static dashboard. Reports compile server-side and download as
self-contained HTML.

```
┌────────────┐   tiered OCR    ┌──────────────────┐  zod-validated   ┌─────────────┐
│  documents │ ──────────────▶ │ extraction agent │ ───────────────▶ │  fact store │
│ (pdf/img/  │  text → tesseract│  (per doc kind)  │   +normalize     │ (Supabase / │
│  voice txt)│  → vision model  └──────────────────┘                  │  in-memory) │
└────────────┘                                                          ↓
                                              ┌───────────────────────────────────┐
                                              │  report compiler (rules engine)   │
                                              │  persona × preferences × records  │
                                              └───────────────────────────────────┘
                                                        ↓ ReportSpec (JSON)
                                              ┌─────────────────┐  ┌──────────────┐
                                              │ React renderer  │  │ HTML export  │
                                              │ (section        │  │ (print → PDF)│
                                              │  registry)      │  └──────────────┘
                                              └─────────────────┘
```

## Quick start (zero external services)

```bash
npm install
npm run dev:server        # :8787 — seeds a demo patient automatically
npm run dev:web           # :5173 — open http://localhost:5173
```

Optional checks:

```bash
npm test                  # pipeline + compiler unit tests
npm run eval              # field-level extraction accuracy harness
npm run typecheck
```

## What's inside

| Path | What |
|---|---|
| `apps/server` | Fastify API: tiered OCR router, extraction agents, normalizer, report compiler, retention/export endpoints |
| `apps/web` | React + TS frontend: generative report renderer, documents, medications, settings/privacy |
| `packages/shared` | zod domain contracts — the single source of truth both sides validate against |
| `supabase/migrations` | Postgres schema with row-level security on every user table |
| `docs/` | [Demo setup & walkthrough](docs/DEMO_SETUP.md) · [Architecture](docs/ARCHITECTURE.md) · [Model choices](docs/MODELS.md) · [Improvements & infra roadmap](docs/IMPROVEMENTS.md) |

## Key design decisions

- **Tiered OCR with evidence-based escalation.** Digital PDFs use their embedded text
  layer (free). Clean scans use classical OCR (cheap). Only handwriting, stamps and
  low-confidence output escalate to a vision LLM (expensive). Every escalation is
  recorded in `extraction_jobs`.
- **Agents propose, schemas dispose.** LLM output is parsed by zod before anything
  touches the record store. Malformed output fails the job — it never enters the DB.
- **Every fact carries provenance**: source document, per-field confidence, evidence
  quote, verification state. Low-confidence documents land in a human review queue;
  nothing is silently trusted.
- **Generative reports, not dashboards.** The compiler's rule engine decides *which*
  sections exist, their order, and their payloads from the persona (age band,
  conditions → tags like `diabetic`) and user preferences (focus areas, detail level,
  language). Each section ships a user-visible *"why am I seeing this"* rationale.
- **Privacy by construction.** RLS on all tables, user-controlled retention policy,
  one-click JSON export of everything, one-click full deletion, append-only audit log,
  and model-training consent defaulting to **off**.

## The accuracy claim, made honest

`npm run eval` runs the labeled-fixture harness and reports per-kind + overall
**field-level accuracy**, plus classification accuracy, against a synthetic
corpus of 16 documents / 137 gold fields spanning all 7 document kinds
(`apps/server/src/eval/fixtures/`). Fixtures carry no embedded answers — the
harness calls the real `ExtractionAgent` through whichever `LlmClient` is
configured.

That distinction matters: with the default `LLM_PROVIDER=mock`, the run
**correctly scores ~0%**, because `MockLlmClient` never reads document text —
it only echoes a canned block when a fixture embeds one (used for the offline
demo/seed, not this corpus). A mock-mode score is a leakage smoke test, not an
accuracy claim; the harness prints which mode produced a given number and
stamps every run to `fixtures/results/*.json` for an auditable trail. Set
`LLM_PROVIDER=openai` (+ `OPENAI_API_KEY`, see Mode B in `docs/DEMO_SETUP.md`)
to get a real, citable number — that's also how to grow the corpus into a
scaled accuracy claim: add more labeled documents per kind and re-run.
Methodology is documented in the harness header and in `docs/MODELS.md`.

## Production wiring

The default run uses an in-memory store and deterministic mock AI providers so anyone
can clone-and-run. To go real, set env (see `.env.example`):

```bash
STORE_BACKEND=supabase SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
LLM_PROVIDER=openai OCR_PROVIDER=openai OPENAI_API_KEY=... \
npm run dev:server
```

Schema lives in `supabase/migrations/` (apply with `supabase db push`).
Deployment, scaling and the hardening roadmap: **docs/IMPROVEMENTS.md**.

---

*Vitalis is an engineering project, not a medical device. Nothing it renders is medical
advice.*
