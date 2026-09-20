import { NextResponse } from "next/server";
import { gameVersion } from "@/lib/data";
import { buildFrozenGameDocument, FROZEN_GAME_DOCUMENT_NONCE, gameDocumentContentSecurityPolicy } from "@/lib/game-runtime";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

const cleanPresentationStyle = `<style nonce="${FROZEN_GAME_DOCUMENT_NONCE}">
.overlay{background:radial-gradient(circle at 50% 38%,rgba(47,107,255,.22),transparent 36%),linear-gradient(180deg,#071426,#030813)!important}
.overlay>div{width:min(100%,560px);padding:18px}
.overlay h1{font-size:clamp(27px,5vw,44px)!important;line-height:1!important;text-wrap:balance}
.overlay p{max-width:460px!important;font-size:clamp(12px,1.55vw,14px)!important;line-height:1.45!important;text-wrap:balance}
.hint{display:none!important}
</style>`;

export async function GET(request: Request, context: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await context.params;
  const session = await auth();
  const version = await gameVersion(versionId, session?.user?.id);
  if (!version) return new NextResponse("Game version not found", { status: 404 });
  const persistedArtifact = Boolean(version.document_html);
  const html = version.document_html ?? buildFrozenGameDocument(version.config);
  const cleanPresentation = new URL(request.url).searchParams.get("presentation") === "clean";
  const responseHtml = cleanPresentation ? html.replace("</head>", `${cleanPresentationStyle}</head>`) : html;
  return new NextResponse(responseHtml, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cleanPresentation || session?.user?.id || !persistedArtifact ? "private, no-store" : "public, max-age=31536000, immutable",
      "Content-Security-Policy": gameDocumentContentSecurityPolicy(),
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
