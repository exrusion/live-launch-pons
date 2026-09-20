import { NextRequest, NextResponse } from "next/server";
import { gameByPublicId } from "@/lib/data";
import { hasDatabase, query } from "@/lib/db";

export async function GET(request: NextRequest, context: { params: Promise<{ publicId: string }> }) {
  if (!hasDatabase()) return NextResponse.json({ period: "all", entries: [] });
  const { publicId } = await context.params;
  const game = await gameByPublicId(publicId);
  if (!game) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const period = request.nextUrl.searchParams.get("period") || "all";
  const since = period === "day" ? "1 day" : period === "week" ? "7 days" : null;
  const values: unknown[] = [game.id];
  const where = since ? "AND s.submitted_at > now() - $2::interval" : "";
  if (since) values.push(since);
  const result = await query(
    `SELECT s.score,s.metric,s.submitted_at,s.wallet_address,x.username,x.profile_image_url,
      dense_rank() OVER(ORDER BY s.score DESC,s.submitted_at ASC)::int AS rank
     FROM scores s LEFT JOIN x_accounts x ON x.id=s.x_account_id
     WHERE s.game_id=$1 AND s.validation_status='VALID' ${where}
     ORDER BY s.score DESC,s.submitted_at ASC LIMIT 50`,
    values,
  );
  return NextResponse.json({ period, entries: result.rows }, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=45" } });
}
