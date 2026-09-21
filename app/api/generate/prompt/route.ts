import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generatePromptWithAi } from "@/lib/ai-game-generator";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashIp, requestIp, requireSameOrigin } from "@/lib/security";

const promptRequestSchema = z.object({
  idea: z.string().trim().min(3).max(900),
  category: z.enum(["RUNNER", "FLAPPY", "SHOOTER"]),
  visualStyle: z.string().trim().min(2).max(40),
  difficulty: z.enum(["EASY", "NORMAL", "HARD"]),
}).strict();

export async function POST(request: NextRequest) {
  try {
    if (!request.headers.get("origin")) return NextResponse.json({ error: "Request origin not allowed." }, { status: 403 });
    requireSameOrigin(request);
    const ip = hashIp(requestIp(request.headers));
    const limit = await checkRateLimit(`prompt-writer:${ip}`, 12, 60 * 60);
    if (!limit.allowed) return NextResponse.json({ error: "AI prompt limit reached. Try again later." }, { status: 429 });
    const body = promptRequestSchema.parse(await request.json());
    const prompt = await generatePromptWithAi(body.idea, body);
    return NextResponse.json({ prompt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Add a short game idea first." }, { status: 400 });
    if (error instanceof Error && error.message === "INVALID_ORIGIN") return NextResponse.json({ error: "Request origin not allowed." }, { status: 403 });
    console.error("prompt_generation_failed", { errorClass: error instanceof Error ? error.constructor.name : "UnknownError" });
    return NextResponse.json({ error: "AI could not write the prompt right now. Try again." }, { status: 503 });
  }
}
