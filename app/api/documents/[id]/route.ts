import fs from "node:fs";
import path from "node:path";
import { q, DATA_DIR } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { currentProfile } from "@/lib/session";

// Decrypts and serves one page image of a stored document — only to the profile that owns it.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { profile } = await currentProfile();
  const doc = q.doc(Number((await params).id));
  if (!profile || !doc || doc.profile_id !== profile.id || !doc.file_path) return new Response("Not found", { status: 404 });
  const pages: string[] = JSON.parse(decrypt(fs.readFileSync(path.join(DATA_DIR, doc.file_path))).toString());
  const page = pages[Number(new URL(req.url).searchParams.get("page") ?? 0)];
  if (!page) return new Response("Not found", { status: 404 });
  const [, mime, b64] = page.match(/^data:([^;]+);base64,(.*)$/)!;
  return new Response(Buffer.from(b64, "base64"), { headers: { "content-type": mime, "cache-control": "private, no-store" } });
}
