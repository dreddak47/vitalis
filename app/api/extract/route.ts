import { z } from "zod";
import { extractImage, toRows } from "@/lib/extract";
import { LLMError } from "@/lib/llm";
import { currentProfile } from "@/lib/session";

const Body = z.object({ image: z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(8_000_000) });

export async function POST(req: Request) {
  if (!(await currentProfile()).profile) return Response.json({ error: "Create a profile first" }, { status: 400 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Send one PNG/JPEG/WebP page image under 6 MB" }, { status: 400 });
  try {
    return Response.json(toRows(await extractImage(body.data.image)));
  } catch (e) {
    const msg = e instanceof LLMError ? e.message : "Could not read this document";
    if (!(e instanceof LLMError)) console.error("extract failed", (e as Error).message);
    return Response.json({ error: msg }, { status: 502 });
  }
}
