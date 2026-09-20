import { NextRequest, NextResponse } from "next/server";
import { generateGameConfig, createGameSchema, versionIdentity } from "@/lib/game-generator";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashIp, requestIp, requireSameOrigin, safeError } from "@/lib/security";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const ip = hashIp(requestIp(request.headers));
    const rate = await checkRateLimit(`preview:${ip}`, 12, 60 * 60);
    if (!rate.allowed) return NextResponse.json({ error: "Too many previews. Try again later." }, { status: 429 });
    const input = createGameSchema.parse(await request.json());
    const config = generateGameConfig(input);
    const version = versionIdentity(config);
    return NextResponse.json({ config, version }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
