import { z } from "zod";
import { ask } from "@/lib/ask";
import { currentProfile } from "@/lib/session";

export async function POST(req: Request) {
  const { profile } = await currentProfile();
  if (!profile) return Response.json({ error: "Create a profile first" }, { status: 400 });
  const body = z.object({ question: z.string().min(2).max(500) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Ask a question (2–500 characters)" }, { status: 400 });
  return Response.json(await ask(body.data.question, profile.id));
}
