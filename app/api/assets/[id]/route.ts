import { NextResponse } from "next/server";
import { hasDatabase, query } from "@/lib/db";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasDatabase()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await context.params;
  const session = await auth();
  const result = await query<{ data: Buffer; mime_type: string; sha256: string; byte_size: number; is_owner: boolean; is_public: boolean }>(
    `SELECT a.data,a.mime_type,a.sha256,a.byte_size,
       (g.owner_user_id=$2::uuid) AS is_owner,
       (a.kind='TOKEN_IMAGE' AND a.immutable=true AND (
         g.status IN ('LIVE','DEMO') OR EXISTS (
           SELECT 1 FROM pons_launches p
           WHERE p.game_id=g.id AND p.status IN ('SUBMITTED','CONFIRMING','CONFIRMED')
         )
       )) AS is_public
     FROM assets a JOIN games g ON g.id=a.game_id
     WHERE a.id::text=$1 AND a.scan_status='APPROVED' AND a.moderation_status='APPROVED'
       AND (g.owner_user_id=$2::uuid OR (
         a.kind='TOKEN_IMAGE' AND a.immutable=true AND (
           g.status IN ('LIVE','DEMO') OR EXISTS (
             SELECT 1 FROM pons_launches p
             WHERE p.game_id=g.id AND p.status IN ('SUBMITTED','CONFIRMING','CONFIRMED')
           )
         )
       ))
     LIMIT 1`,
    [id, session?.user?.id || null],
  );
  const asset = result.rows[0];
  if (!asset?.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mime_type,
      "Content-Length": String(asset.byte_size),
      "Cache-Control": asset.is_public && !asset.is_owner ? "public, max-age=31536000, immutable" : "private, no-store",
      ETag: `"${asset.sha256}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
