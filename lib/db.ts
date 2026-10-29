import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.VITALIS_DATA_DIR ?? path.join(process.cwd(), "data");

const SCHEMA = `
create table if not exists profiles (
  id integer primary key, name text not null, dob text, sex text,
  view_pref text not null default 'standard', demo_source text
);
create table if not exists documents (
  id integer primary key, profile_id integer not null references profiles(id) on delete cascade,
  kind text not null, file_path text, mime text, uploaded_at text not null default (datetime('now')),
  report_date text, lab text
);
create table if not exists results (
  id integer primary key, profile_id integer not null references profiles(id) on delete cascade,
  document_id integer references documents(id) on delete set null,
  test_code text, test_name text not null, value real not null, unit text not null,
  ref_low real, ref_high real, taken_at text not null, verified integer not null default 1
);
create index if not exists results_profile_code on results(profile_id, test_code, taken_at);
create table if not exists medications (
  id integer primary key, profile_id integer not null references profiles(id) on delete cascade,
  document_id integer references documents(id) on delete set null,
  name text not null, dose text, frequency text, start_date text, end_date text
);
create table if not exists pins (profile_id integer not null references profiles(id) on delete cascade, card_key text not null, primary key (profile_id, card_key));
create table if not exists layouts (profile_id integer primary key references profiles(id) on delete cascade, data_version text not null, json text not null, source text not null);
`;

let _db: DatabaseSync | undefined;
export function db() {
  if (!_db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    _db = new DatabaseSync(path.join(DATA_DIR, "vitalis.db"));
    _db.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    _db.exec(SCHEMA);
  }
  return _db;
}

export type Profile = { id: number; name: string; dob: string | null; sex: string | null; view_pref: "standard" | "simple"; demo_source: string | null };
export type Result = { id: number; profile_id: number; document_id: number | null; test_code: string | null; test_name: string; value: number; unit: string; ref_low: number | null; ref_high: number | null; taken_at: string };
export type Medication = { id: number; profile_id: number; document_id: number | null; name: string; dose: string | null; frequency: string | null; start_date: string | null; end_date: string | null };
export type Doc = { id: number; profile_id: number; kind: string; file_path: string | null; mime: string | null; uploaded_at: string; report_date: string | null; lab: string | null };

// node:sqlite returns null-prototype rows; spread them into plain objects so they can cross to client components.
const plain = <T,>(rows: unknown[]) => rows.map((r) => ({ ...(r as object) })) as T[];

export const q = {
  profiles: () => plain<Profile>(db().prepare("select * from profiles order by id").all()),
  profile: (id: number) => plain<Profile>(db().prepare("select * from profiles where id = ?").all(id))[0],
  results: (pid: number, code?: string) =>
    plain<Result>(code
      ? db().prepare("select * from results where profile_id = ? and test_code = ? order by taken_at, id").all(pid, code)
      : db().prepare("select * from results where profile_id = ? order by taken_at, id").all(pid)),
  meds: (pid: number) => plain<Medication>(db().prepare("select * from medications where profile_id = ? order by coalesce(start_date, '')").all(pid)),
  docs: (pid: number) => plain<Doc>(db().prepare("select * from documents where profile_id = ? order by uploaded_at desc").all(pid)),
  doc: (id: number) => plain<Doc>(db().prepare("select * from documents where id = ?").all(id))[0],
  pins: (pid: number) => (db().prepare("select card_key from pins where profile_id = ?").all(pid) as { card_key: string }[]).map((r) => r.card_key),
  docCount: (pid: number) => (db().prepare("select count(*) n from documents where profile_id = ?").get(pid) as { n: number }).n,
  /** Changes whenever this profile's data changes, so cached layouts refresh only then. */
  dataVersion: (pid: number) => {
    const r = db().prepare("select (select count(*) || ':' || coalesce(max(id),0) from results where profile_id = ?1) || '/' || (select count(*) || ':' || coalesce(max(id),0) from medications where profile_id = ?1) || '/' || (select view_pref from profiles where id = ?1) v").get(pid) as { v: string };
    return r.v;
  },
};

/** Latest value per test for a profile (same ordering as q.results, so cards and charts agree on ties). */
export function latestByTest(pid: number) {
  const m = new Map<string, Result>();
  for (const r of q.results(pid)) if (r.test_code) m.set(r.test_code, r);
  return m;
}
