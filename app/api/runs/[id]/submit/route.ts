import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { REPLAY_VALIDATOR_VERSION, validateReplay, type ReplayEvent } from "@/lib/scores";
import { requireSameOrigin, safeError, sha256 } from "@/lib/security";
import type { GameCategory, GameConfig } from "@/lib/types";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json();
    const result = await transaction(async (client) => {
      const runResult = await client.query<{
        id: string; game_version_id: string; wallet_address: string; x_account_id: string; server_seed_hash: string;
        run_token_hash: string; game_id: string; category: GameCategory; config: GameConfig; started_at: Date | null;
        expires_at: Date; consumed_at: Date | null;
      }>(
        `SELECT r.*,v.game_id,v.config,g.category FROM run_sessions r JOIN game_versions v ON v.id=r.game_version_id JOIN games g ON g.id=v.game_id
         JOIN x_accounts x ON x.id=r.x_account_id WHERE r.id=$1 AND x.user_id=$2 FOR UPDATE`,
        [id, session.user!.id],
      );
      const run = runResult.rows[0];
      if (!run || run.run_token_hash !== sha256(String(body.runToken || ""))) throw new Error("RUN_NOT_FOUND");
      if (run.expires_at.getTime() < Date.now()) throw new Error("RUN_EXPIRED");
      if (run.consumed_at) throw new Error("RUN_ALREADY_SUBMITTED");
      if (!run.started_at) throw new Error("RUN_NOT_STARTED");
      const serverElapsedMs = Date.now() - run.started_at.getTime();
      if (!Number.isSafeInteger(body.durationMs) || body.durationMs > serverElapsedMs + 3_000) throw new Error("RUN_CLOCK_MISMATCH");
      const validation = validateReplay({
        category: run.category,
        score: body.score,
        durationMs: body.durationMs,
        events: body.events as ReplayEvent[],
        seedHash: run.server_seed_hash,
        speed: run.config.speed,
        difficulty: run.config.difficulty,
        mechanics: run.config.mechanics,
      });
      const replayHash = validation.valid ? validation.replayHash! : sha256(JSON.stringify(body.events || []));
      const score = await client.query<{ id: string }>(
        `INSERT INTO scores(run_session_id,game_id,game_version_id,wallet_address,x_account_id,metric,score,validation_status,validation_reason,replay_hash,duration_ms,validated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()) RETURNING id`,
        [id, run.game_id, run.game_version_id, run.wallet_address, run.x_account_id, run.category === "FLAPPY" ? "GATES" : "SCORE", body.score, validation.valid ? "VALID" : "REJECTED", validation.reason, replayHash, body.durationMs],
      );
      await client.query(
        `INSERT INTO score_replays(score_id,event_log,seed_hash,duration_ms,replay_hash,validator_version)
         VALUES($1,$2::jsonb,$3,$4,$5,$6)`,
        [score.rows[0].id, JSON.stringify(body.events || []), run.server_seed_hash, body.durationMs, replayHash, REPLAY_VALIDATOR_VERSION],
      );
      await client.query("UPDATE run_sessions SET consumed_at=now() WHERE id=$1", [id]);
      return { scoreId: score.rows[0].id, status: validation.valid ? "VALID" : "REJECTED", reason: validation.reason };
    });
    return NextResponse.json(result, { status: result.status === "VALID" ? 201 : 422 });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
