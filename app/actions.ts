"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import { db, q, DATA_DIR } from "@/lib/db";
import { seedDemo } from "@/lib/seed";
import { currentProfile } from "@/lib/session";

const year = 60 * 60 * 24 * 365;

export async function switchProfile(formData: FormData) {
  (await cookies()).set("pid", String(Number(formData.get("pid"))), { httpOnly: true, sameSite: "lax", maxAge: year });
  revalidatePath("/", "layout");
}

export async function createProfile(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return;
  const dob = String(formData.get("dob") ?? "") || null;
  const sex = String(formData.get("sex") ?? "") || null;
  const id = db().prepare("insert into profiles (name, dob, sex) values (?, ?, ?)").run(name, dob, sex).lastInsertRowid;
  (await cookies()).set("pid", String(id), { httpOnly: true, sameSite: "lax", maxAge: year });
  redirect("/");
}

export async function deleteProfile(formData: FormData) {
  const pid = Number(formData.get("pid"));
  // Remove the encrypted document files too, not just the rows.
  for (const d of q.docs(pid)) if (d.file_path) fs.rmSync(path.join(DATA_DIR, d.file_path), { force: true });
  db().prepare("delete from profiles where id = ?").run(pid);
  revalidatePath("/", "layout");
}

export async function loadDemo() {
  seedDemo();
  const first = db().prepare("select id from profiles where demo_source is not null order by id limit 1").get() as { id: number } | undefined;
  if (first) (await cookies()).set("pid", String(first.id), { httpOnly: true, sameSite: "lax", maxAge: year });
  redirect("/");
}

export async function togglePin(formData: FormData) {
  const { profile } = await currentProfile();
  if (!profile) return;
  const key = String(formData.get("key"));
  const d = db();
  const had = d.prepare("delete from pins where profile_id = ? and card_key = ?").run(profile.id, key).changes;
  if (!had) d.prepare("insert into pins (profile_id, card_key) values (?, ?)").run(profile.id, key);
  revalidatePath("/");
}

export async function setViewPref(formData: FormData) {
  const { profile } = await currentProfile();
  if (!profile) return;
  const pref = formData.get("pref") === "simple" ? "simple" : "standard";
  db().prepare("update profiles set view_pref = ? where id = ?").run(pref, profile.id);
  revalidatePath("/", "layout");
}
