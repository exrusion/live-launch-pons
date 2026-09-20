import { NextResponse } from "next/server";
import { gameVersion } from "@/lib/data";
import { buildFrozenGameDocument, gameDocumentContentSecurityPolicy } from "@/lib/game-runtime";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await context.params;
  const session = await auth();
  const version = await gameVersion(versionId, session?.user?.id);
  if (!version) return new NextResponse("Game version not found", { status: 404 });
  const html = version.document_html ?? buildFrozenGameDocument(version.config);
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": session?.user?.id ? "private, no-store" : "public, max-age=31536000, immutable",
      "Content-Security-Policy": gameDocumentContentSecurityPolicy(),
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
