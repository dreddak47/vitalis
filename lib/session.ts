import { cookies } from "next/headers";
import { q } from "./db";

/** Active profile from cookie, falling back to the first profile. Null when there are no profiles yet. */
export async function currentProfile() {
  const all = q.profiles();
  const id = Number((await cookies()).get("pid")?.value);
  return { all, profile: all.find((p) => p.id === id) ?? all[0] ?? null };
}
