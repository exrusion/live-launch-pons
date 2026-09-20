import { NextResponse } from "next/server";
import { hasDatabase, query } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasDatabase()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await context.params;
  const session = await auth();
  const result = await query<{ data: Buffer; mime_type: string; sha256: string; byte_size: number }>(
    `SELECT a.data,a.mime_type,a.sha256,a.byte_size FROM assets a JOIN games g ON g.id=a.game_id
     WHERE a.id::text=$1 AND a.scan_status='APPROVED' AND a.moderation_status='APPROVED'
       AND (g.status IN ('LIVE','DEMO') OR g.owner_user_id=$2::uuid)
     LIMIT 1`,
    [id, session?.user?.id || null],
  );
  const asset = result.rows[0];
  if (!asset?.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mime_type,
      "Content-Length": String(asset.byte_size),
      "Cache-Control": session?.user?.id ? "private, no-store" : "public, max-age=31536000, immutable",
      ETag: `"${asset.sha256}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
