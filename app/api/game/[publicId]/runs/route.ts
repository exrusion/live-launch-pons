import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { gameByPublicId } from "@/lib/data";
import { query } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashIp, makeNonce, requestIp, requireSameOrigin, sha256 } from "@/lib/security";

export async function POST(request: NextRequest, context: { params: Promise<{ publicId: string }> }) {
  requireSameOrigin(request);
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in with X and verify a wallet to submit scores." }, { status: 401 });
  const { publicId } = await context.params;
  const game = await gameByPublicId(publicId, session.user.id);
  if (!game || game.status === "DRAFT") return NextResponse.json({ error: "Game not found." }, { status: 404 });
  if (game.id === "demo" && !process.env.DATABASE_URL) return NextResponse.json({ error: "Score storage is not configured." }, { status: 503 });
  const rate = await checkRateLimit(`run:${session.user.id}:${hashIp(requestIp(request.headers))}`, 30, 60 * 60);
  if (!rate.allowed) return NextResponse.json({ error: "Too many runs. Take a break and try again." }, { status: 429 });
  const identity = await query<{ wallet: string; x_account_id: string }>(
    `SELECT w.address AS wallet,x.id AS x_account_id FROM wallets w JOIN x_accounts x ON x.user_id=w.user_id
     WHERE w.user_id=$1 AND w.is_primary=true LIMIT 1`,
    [session.user.id],
  );
  if (!identity.rows[0]) return NextResponse.json({ error: "Verify a wallet before joining the leaderboard." }, { status: 403 });
  const runToken = makeNonce(32);
  const seed = makeNonce(18);
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const result = await query<{ id: string }>(
    `INSERT INTO run_sessions(game_version_id,wallet_address,x_account_id,server_seed_hash,run_token_hash,expires_at)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
    [game.version_id, identity.rows[0].wallet, identity.rows[0].x_account_id, sha256(seed), sha256(runToken), expiresAt],
  );
  return NextResponse.json({ runId: result.rows[0].id, runToken, expiresAt: expiresAt.toISOString() }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
