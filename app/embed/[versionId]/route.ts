import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { gameVersion } from "@/lib/data";
import { buildGameDocument } from "@/lib/game-runtime";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await context.params;
  const session = await auth();
  const version = await gameVersion(versionId, session?.user?.id);
  if (!version) return new NextResponse("Game version not found", { status: 404 });
  const nonce = randomBytes(16).toString("base64");
  const html = buildGameDocument(version.config, { nonce, versionId: version.id });
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": session?.user?.id ? "private, no-store" : "public, max-age=31536000, immutable",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'none'; img-src data:; media-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
