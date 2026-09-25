-- Vitalis — initial schema
-- All user data is scoped by user_id and protected by row-level security.
-- Design notes:
--  * Every fact table carries document_id + confidence + verification so the
--    record is always traceable back to a source document and a model run.
--  * Raw files live in Supabase Storage bucket `documents` (private); only the
--    owning user can read via signed URLs. Path convention: <user_id>/<doc_id>.
--  * values that feed the generative report compiler are plain columns;
--    anything open-ended goes into jsonb (e.g. report_specs.spec).

-- ---------------------------------------------------------------------------
-- profiles: extends auth.users; never insert rows for other users
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  display_name   text not null default '',
  dob            date,
  sex            text check (sex in ('female','male','intersex','unknown')),
  height_cm      numeric(5,1) check (height_cm is null or height_cm between 30 and 300),
  weight_kg      numeric(5,1) check (weight_kg is null or weight_kg between 1 and 700),
  preferences    jsonb not null default '{}'::jsonb,   -- DisplayPreferences (validated in app layer)
  retention      jsonb not null default '{}'::jsonb,   -- RetentionPolicy
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- documents: one row per uploaded file (report, scan, voice memo transcript…)
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null default 'unknown' check (kind in
                ('lab_report','prescription','discharge_summary','doctor_note',
                 'radiology_report','voice_memo','insurance_claim','unknown')),
  title         text not null,
  mime_type     text not null,
  storage_path  text,
  content_hash  text not null,            -- sha256, dedupe + integrity
  recorded_at   date,                     -- clinical date, distinct from upload date
  status        text not null default 'uploaded' check (status in
                ('uploaded','processing','needs_review','processed','failed')),
  raw_text      text,                     -- OCR/transcription output
  ocr_tier      text check (ocr_tier in ('tier1_text_layer','tier2_classical_ocr','tier3_vision_model')),
  created_at    timestamptz not null default now()
);
create index if not exists documents_user_idx on public.documents(user_id, created_at desc);
create unique index if not exists documents_user_hash_uidx on public.documents(user_id, content_hash);

-- ---------------------------------------------------------------------------
-- extraction_jobs: audit trail of every pipeline run (tier, model, outcome)
-- ---------------------------------------------------------------------------
create table if not exists public.extraction_jobs (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  ocr_tier      text,
  model         text,                     -- e.g. "gpt-4o", "tesseract-5.3"
  status        text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  mean_confidence numeric(4,3),
  fields_total      int,
  fields_below_threshold int,
  error         text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists extraction_jobs_doc_idx on public.extraction_jobs(document_id);

-- ---------------------------------------------------------------------------
-- fact tables (uniform shape: provenance + confidence + verification)
-- ---------------------------------------------------------------------------
create table if not exists public.medications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  document_id   uuid not null references public.documents(id) on delete cascade,
  drug_name     text not null,
  dose_amount   numeric,
  dose_unit     text,
  frequency     text,
  route         text,
  prescriber    text,
  start_date    date,
  end_date      date,
  instructions  text,
  status        text not null default 'active' check (status in ('active','discontinued')),
  confidence    numeric(4,3) not null,
  verification  text not null default 'unverified' check (verification in ('unverified','auto_verified','human_verified')),
  created_at    timestamptz not null default now()
);
create index if not exists medications_user_idx on public.medications(user_id, status);

create table if not exists public.conditions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  document_id   uuid not null references public.documents(id) on delete cascade,
  name          text not null,
  icd10         text,
  status        text check (status in ('active','resolved','suspected')),
  diagnosed_at  date,
  confidence    numeric(4,3) not null,
  verification  text not null default 'unverified' check (verification in ('unverified','auto_verified','human_verified')),
  created_at    timestamptz not null default now()
);
create index if not exists conditions_user_idx on public.conditions(user_id);

create table if not exists public.lab_results (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  document_id   uuid not null references public.documents(id) on delete cascade,
  analyte       text not null,            -- canonical key, e.g. 'hba1c'
  display_name  text not null,            -- 'Hemoglobin A1c'
  value         numeric,
  unit          text,
  ref_low       numeric,
  ref_high      numeric,
  flag          text check (flag in ('low','normal','high','critical')),
  measured_at   date,
  confidence    numeric(4,3) not null,
  verification  text not null default 'unverified' check (verification in ('unverified','auto_verified','human_verified')),
  created_at    timestamptz not null default now()
);
create index if not exists lab_results_user_analyte_idx on public.lab_results(user_id, analyte, measured_at);

create table if not exists public.vitals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  document_id   uuid not null references public.documents(id) on delete cascade,
  kind          text not null check (kind in ('blood_pressure','heart_rate','weight','height','spo2','temperature')),
  value         numeric,
  value_secondary numeric,
  unit          text,
  measured_at   date,
  confidence    numeric(4,3) not null,
  verification  text not null default 'unverified' check (verification in ('unverified','auto_verified','human_verified')),
  created_at    timestamptz not null default now()
);
create index if not exists vitals_user_kind_idx on public.vitals(user_id, kind, measured_at);

create table if not exists public.allergies (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  document_id   uuid not null references public.documents(id) on delete cascade,
  substance     text not null,
  reaction      text,
  severity      text check (severity in ('mild','moderate','severe')),
  confidence    numeric(4,3) not null,
  verification  text not null default 'unverified' check (verification in ('unverified','auto_verified','human_verified')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- report_specs: compiled generative reports (spec JSON both rendered and exported)
-- ---------------------------------------------------------------------------
create table if not exists public.report_specs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  spec        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists report_specs_user_idx on public.report_specs(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- audit_log: every sensitive action (export, delete, retention purge, verify)
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  action      text not null,              -- 'export' | 'delete_document' | 'verify_fact' | ...
  entity      text,
  entity_id   text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_user_idx on public.audit_log(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security: users can only ever see and mutate their own rows.
-- The service-role key (used by the server for pipeline writes) bypasses RLS;
-- the anon/authenticated role is constrained by these policies.
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.documents       enable row level security;
alter table public.extraction_jobs enable row level security;
alter table public.medications     enable row level security;
alter table public.conditions      enable row level security;
alter table public.lab_results     enable row level security;
alter table public.vitals          enable row level security;
alter table public.allergies       enable row level security;
alter table public.report_specs    enable row level security;
alter table public.audit_log       enable row level security;

create policy "own profile"        on public.profiles        for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own documents"      on public.documents       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own jobs"           on public.extraction_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own medications"    on public.medications     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own conditions"     on public.conditions      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own labs"           on public.lab_results     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own vitals"         on public.vitals          for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own allergies"      on public.allergies       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reports"        on public.report_specs    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own audit"          on public.audit_log       for select using (auth.uid() = user_id);
-- audit_log rows are written only by the server (service role); users can read but not insert/delete.
