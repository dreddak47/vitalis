"use client";
import { switchProfile } from "@/app/actions";

export default function ProfileSwitcher({ profiles, current }: { profiles: { id: number; name: string }[]; current: number }) {
  return (
    <form action={switchProfile}>
      <label className="sr-only" htmlFor="pid">Profile</label>
      <select id="pid" name="pid" defaultValue={current} onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="max-w-[11rem] truncate rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm sm:max-w-xs">
        {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </form>
  );
}
