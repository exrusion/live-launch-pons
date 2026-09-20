import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { query } from "@/lib/db";
import { requireSameOrigin, safeError } from "@/lib/security";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    const result = await query<{ started_at: Date }>(
      `UPDATE run_sessions r SET started_at=COALESCE(r.started_at,now())
       FROM x_accounts x
       WHERE r.id=$1 AND r.x_account_id=x.id AND x.user_id=$2
         AND r.consumed_at IS NULL AND r.expires_at>now()
       RETURNING r.started_at`,
      [id, session.user.id],
    );
    if (!result.rows[0]) return NextResponse.json({ error: "Run is missing or expired." }, { status: 404 });
    return NextResponse.json({ started: true, startedAt: result.rows[0].started_at }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
