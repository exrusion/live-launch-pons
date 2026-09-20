import { NextRequest, NextResponse } from "next/server";
import { generateGameConfig, createGameSchema, freezeGameVersion } from "@/lib/game-generator";
import { issuePreviewToken, PreviewTokenConfigurationError } from "@/lib/preview-token";
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
    const frozen = freezeGameVersion(config);
    const { documentHtml: previewHtml, ...version } = frozen;
    const previewToken = issuePreviewToken(input, version);
    return NextResponse.json({ config, version, previewHtml, previewToken }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PreviewTokenConfigurationError) {
      return NextResponse.json({ error: "Preview service is temporarily unavailable." }, { status: 503 });
    }
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
