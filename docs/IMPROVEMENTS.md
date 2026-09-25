# Improvements, Infrastructure & Roadmap

Everything needed to take this repo from "clean demo" to "production health
product", in the order it should happen.

---

## Phase 0 — what you have now (repo state)

- Full pipeline: tiered OCR → domain extraction agents → normalization →
  confidence-gated fact store → generative report compiler → HTML export.
- Runs with zero external services (memory store + deterministic mock providers).
- Supabase schema with RLS written but only exercised via `SupabaseStore` code path.
- Eval harness with synthetic fixtures; unit tests cover the pipeline invariants.

## Phase 1 — make it real (1–2 weeks)

### Infrastructure setup

1. **Supabase project**
   ```bash
   supabase init && supabase link --project-ref <ref>
   supabase db push                      # applies 0001_init.sql
   supabase storage create-bucket documents --private
   ```
   Add a storage RLS policy: `auth.uid()::text = (storage.foldername(name))[1]`.
2. **Server deploy** — Fly.io or Render (single container, 512 MB is plenty).
   Set env from `.env.example`: `STORE_BACKEND=supabase`, keys, models.
3. **Auth** — Supabase Auth magic links. Add a Fastify preHandler that verifies the
   `Authorization: Bearer <jwt>` against `SUPABASE_JWT_SECRET` and replaces
   `:userId` with the token's `sub`. The routes are already shaped for this
   (`/api/users/:userId/…`) so it is a 30-line change, not a refactor.
4. **Web deploy** — Vercel/Netlify static build; set `VITE_API_URL` and drop the
   dev proxy.
5. **Secrets** — Doppler/1Password Connect or the platform's secret store.
   Never `.env` in CI logs.

### Model wiring

- `LLM_PROVIDER=openai`, pick per docs/MODELS.md. Turn on the provider's
  zero-retention mode if offered; sign a **BAA** before any real PHI touches any
  third-party API — this is a hard legal gate, not a preference.
- Tier-2 OCR: Google Document AI behind `RemoteOcrProvider.classicalOcr`
  (the method stub already exists).

## Phase 2 — reliability & correctness hardening

1. **Async pipeline jobs.** Move ingestion off the request path: upload → enqueue
   (Supabase queue / SQS / pg-boss) → worker runs OCR+extraction → webhook/poll
   updates status. The `extraction_jobs` table is already the queue ledger;
   `status='queued'` and `started_at` are in the schema for exactly this.
2. **Retry & idempotency.** Jobs already carry `content_hash` dedupe; add
   attempt counters and exponential backoff for provider 429/5xx.
3. **Confidence calibration.** Collect `human_verified` vs corrected fields from
   the review queue; fit an isotonic/Platt calibrator per (kind, tier) and store
   correction curves — reported confidence should track empirical accuracy.
4. **Deeper normalization.** Swap the in-code alias tables for real terminology
   services (RxNorm API, LOINC, ICD-10-CM) behind the same `canonical*` function
   signatures. Cache aggressively; they're mostly static.
5. **Contract tests.** Fastify inject-based tests per route (the zod schemas
   make fuzzing cheap: generate garbage, assert 400s).

## Phase 3 — the features that make users stay

1. **Medication intelligence** (the tab exists; now give it superpowers):
   - drug–drug and drug–allergy interaction checks (openFDA / DrugBank data,
     evaluated against the allergy table);
   - refill prediction from `dose × frequency × prescribed days`;
   - adherence via quick daily check-ins, feeding a new `adherence` series that
     the compiler's `medication_adherence` section already knows how to render.
2. **Voice loop.** Browser MediaRecorder → Whisper (or self-hosted
   `whisper.cpp`/faster-whisper) → the existing `voice_memo` extraction path.
   The pipeline already treats transcripts as tier-1 input.
3. **Proactive compiler.** Add a `change_detector` rule: diff consecutive
   report specs, and when a lab crosses a threshold (HbA1c 5.7→6.5) emit a
   risk-flag section explaining *what changed and since when*. Trend deltas are
   strictly more actionable than static values.
4. **Multi-modal reports.** Server-side chart rendering (the Sparkline data
   shape already exists in section props) embedded into the HTML export, plus
   a PDF engine (Playwright print-to-PDF as a job).
5. **Family/caregiver accounts.** Scoped delegation: `profile_shares` table
   with per-section read grants. The ReportSpec section model makes per-section
   sharing natural — share "medications" without sharing "mental_health".

## Phase 4 — scale & compliance

1. **Observability**: OpenTelemetry traces across pipeline stages (one span per
   tier/agent), structured logs with `document_id`/`job_id` correlation, Sentry
   on both apps, per-tier latency + accuracy dashboards. The eval harness output
   belongs in CI as an artifact on every model/prompt change.
2. **Cost control**: per-user token budgets, tier-3 rate limiting, caching
   extraction by `content_hash + prompt_version`, and spot quota for self-hosted
   Qwen2.5-VL on cheaper GPU tiers.
3. **Compliance posture** (if targeting real users, in order):
   - threat model + data-flow diagram (this doc's architecture section is the seed);
   - encryption at rest (Supabase default) + per-user envelope keys for storage;
   - retention enforcement worker actually *deleting* storage objects when
     `rawFileRetentionDays` lapses (the policy column exists; schedule a daily
     edge function / cron);
   - audit-log export for the user (UI exists for export — extend to audit);
   - DPIA, terms that clearly say "not medical advice", malpractice-sensitive
     copy review.
4. **Eval corpus growth**: keep every reviewed correction as a new gold label.
   The review queue is not just a safety feature — it is your annotation
   pipeline. Each correction = one more gold field; target 100+ documents per
   kind before per-kind accuracy claims.

## Non-goals (deliberately)

- **Auto-diagnosis.** The compiler surfaces data and guidelines-anchored
  reminders; it never tells the user what they have.
- **Real-time vitals/Wearable sync** before Phase 3 is proven — it invites
  regulatory classification creep and multiplies review-queue noise.
- **Generic chatbot.** A "ask your records anything" LLM chat is far less
  defensible (hallucination surface) than the compiled, cited report. If added,
  constrain it to retrieval over verified facts with mandatory citations.
