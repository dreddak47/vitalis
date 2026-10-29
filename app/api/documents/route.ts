import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db, DATA_DIR } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { findTest } from "@/lib/tests";
import { customCode } from "@/lib/extract";
import { currentProfile } from "@/lib/session";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.object({
  kind: z.enum(["lab_report", "prescription", "other"]),
  date: date.nullish(),
  lab: z.string().max(200).nullish(),
  pages: z.array(z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(8_000_000)).max(20),
  rows: z.array(z.object({
    name: z.string().min(1).max(120), value: z.number().finite(), unit: z.string().max(40),
    ref_low: z.number().finite().nullish(), ref_high: z.number().finite().nullish(),
  })).max(300),
  meds: z.array(z.object({ name: z.string().min(1).max(200), dose: z.string().max(100).nullish(), frequency: z.string().max(100).nullish() })).max(100),
});

export async function POST(req: Request) {
  const { profile } = await currentProfile();
  if (!profile) return Response.json({ error: "Create a profile first" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: `Invalid document: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` }, { status: 400 });
  const b = parsed.data;
  const day = b.date ?? new Date().toISOString().slice(0, 10);
  const d = db();

  d.exec("begin");
  try {
    const docId = Number(d.prepare("insert into documents (profile_id, kind, mime, report_date, lab) values (?, ?, ?, ?, ?)").run(profile.id, b.kind, "pages+json", day, b.lab ?? null).lastInsertRowid);
    if (b.pages.length) {
      const dir = path.join(DATA_DIR, "docs");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${docId}.enc`);
      fs.writeFileSync(file, encrypt(Buffer.from(JSON.stringify(b.pages))));
      d.prepare("update documents set file_path = ? where id = ?").run(path.relative(DATA_DIR, file), docId);
    }
    const ins = d.prepare("insert into results (profile_id, document_id, test_code, test_name, value, unit, ref_low, ref_high, taken_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const r of b.rows) {
      const t = findTest(r.name);
      ins.run(profile.id, docId, t?.codes[0] ?? customCode(r.name), t?.name ?? r.name, r.value, r.unit, r.ref_low ?? null, r.ref_high ?? null, day);
    }
    const insM = d.prepare("insert into medications (profile_id, document_id, name, dose, frequency, start_date) values (?, ?, ?, ?, ?, ?)");
    for (const m of b.meds) insM.run(profile.id, docId, m.name, m.dose ?? null, m.frequency ?? null, day);
    d.exec("commit");
    revalidatePath("/", "layout");
    return Response.json({ id: docId });
  } catch (e) {
    d.exec("rollback");
    console.error("save document failed", (e as Error).message);
    return Response.json({ error: "Could not save the document" }, { status: 500 });
  }
}
