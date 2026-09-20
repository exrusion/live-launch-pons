import { NextRequest, NextResponse } from "next/server";
import { parseEther } from "viem";
import { auth } from "@/lib/auth";
import { createGameSchema, generateGameConfig, versionIdentity } from "@/lib/game-generator";
import { hashIp, requestIp, requireSameOrigin, safeError, sha256, slugify } from "@/lib/security";
import { transaction } from "@/lib/db";
import { saveTokenImage } from "@/lib/assets";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Sign in with X first." }, { status: 401 });
    const rate = await checkRateLimit(`create:${session.user.id}:${hashIp(requestIp(request.headers))}`, 8, 60 * 60);
    if (!rate.allowed) return NextResponse.json({ error: "Creation limit reached. Try again later." }, { status: 429 });
    const body = await request.json();
    const input = createGameSchema.parse(body.input);
    if (!body.imageDataUrl || typeof body.imageDataUrl !== "string") return NextResponse.json({ error: "A PNG, JPEG, or WebP token image is required." }, { status: 400 });
    const config = generateGameConfig(input);
    const identity = versionIdentity(config);
    const developerBuyWei = parseEther(input.developerBuyEth || "0").toString();
    const suffix = sha256(`${session.user.id}:${identity.deterministicId}:${Date.now()}`).slice(0, 6);
    const slug = `${slugify(input.name) || "game"}-${suffix}`;
    const result = await transaction(async (client) => {
      const game = await client.query<{ id: string }>(
        `INSERT INTO games(owner_user_id,slug,name,ticker,description,category,visual_style,difficulty,prompt,website_url,x_url,developer_buy_wei,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PREVIEW_READY') RETURNING id`,
        [session.user!.id, slug, input.name, input.ticker, input.description, input.category, input.visualStyle, input.difficulty, input.prompt, input.websiteUrl || null, input.xUrl || null, developerBuyWei],
      );
      const gameId = game.rows[0].id;
      const imageId = await saveTokenImage(client, { userId: session.user!.id, gameId, dataUrl: body.imageDataUrl });
      const job = await client.query<{ id: string }>(
        `INSERT INTO generation_jobs(user_id,game_id,status,progress,input_hash,output_hash,provider,model,attempts)
         VALUES($1,$2,'SUCCEEDED',100,$3,$4,'deterministic-template','runtime-v1',1) RETURNING id`,
        [session.user!.id, gameId, sha256(JSON.stringify(input)), identity.configHash],
      );
      await client.query(
        `INSERT INTO game_drafts(game_id,revision,prompt,config,generation_job_id) VALUES($1,1,$2,$3::jsonb,$4)`,
        [gameId, input.prompt, identity.configJson, job.rows[0].id],
      );
      const version = await client.query<{ id: string }>(
        `INSERT INTO game_versions(game_id,version_number,deterministic_id,template_version,runtime_version,config,config_hash,manifest_hash,prompt,release_notes,status,created_by)
         VALUES($1,1,$2,$3,'runtime-v1',$4::jsonb,$5,$6,$7,'Initial playable preview.','PREVIEW',$8) RETURNING id`,
        [gameId, `${identity.deterministicId}-${suffix}`, `${input.category.toLowerCase()}-v1`, identity.configJson, identity.configHash, identity.manifestHash, input.prompt, session.user!.id],
      );
      await client.query("UPDATE games SET current_version_id=$1 WHERE id=$2", [version.rows[0].id, gameId]);
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,request_id,ip_hash,after_data)
         VALUES($1,'USER','GAME_CREATED','GAME',$2,$3,$4,$5::jsonb)`,
        [session.user!.id, gameId, request.headers.get("x-request-id") || crypto.randomUUID(), hashIp(requestIp(request.headers)), JSON.stringify({ versionId: version.rows[0].id, imageId })],
      );
      return { gameId, versionId: version.rows[0].id, imageId, slug };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: safeError(error) }, { status: 400 });
  }
}
