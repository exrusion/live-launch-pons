import { NextRequest, NextResponse } from "next/server";
import { parseEther } from "viem";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";
import { createGameSchema, freezeGameVersion, generateGameConfig, validateGameConfigForInput } from "@/lib/game-generator";
import { previewInputHash, PreviewTokenConfigurationError, PreviewTokenError, verifyPreviewToken } from "@/lib/preview-token";
import { hashIp, requestIp, requireSameOrigin, sha256, slugify } from "@/lib/security";
import { transaction } from "@/lib/db";
import { saveTokenImage } from "@/lib/assets";
import { checkRateLimit } from "@/lib/rate-limit";
import type { GameGenerationMetadata } from "@/lib/types";

const IMAGE_ERROR_MESSAGES: Record<string, string> = {
  INVALID_IMAGE_DATA: "Use a valid PNG, JPEG, or WebP image.",
  INVALID_IMAGE_SIZE: "Use a PNG, JPEG, or WebP image under 2 MB.",
  UNSUPPORTED_IMAGE_TYPE: "Use a valid PNG, JPEG, or WebP image.",
  IMAGE_MIME_MISMATCH: "The image contents do not match its declared type.",
  IMAGE_DIMENSIONS_TOO_LARGE: "Use an image no larger than 4096×4096 pixels.",
};

function unexpectedFailureMetadata(error: unknown) {
  const errorClass = error instanceof Error && /^[A-Za-z0-9_.-]{1,64}$/.test(error.constructor.name)
    ? error.constructor.name
    : "UnknownError";
  const rawCode = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  const code = typeof rawCode === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(rawCode) ? rawCode : "UNCLASSIFIED";
  return { errorClass, code };
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const session = await auth();
    if (!session?.user?.id || !session.user.xId || session.user.accountStatus !== "ACTIVE") {
      return NextResponse.json(
        { error: "Continue with X to save this playable version.", code: "X_AUTH_REQUIRED" },
        { status: 401 },
      );
    }
    const userId = session.user.id;
    const rate = await checkRateLimit(`create:${userId}:${hashIp(requestIp(request.headers))}`, 8, 60 * 60);
    if (!rate.allowed) return NextResponse.json({ error: "Creation limit reached. Try again later." }, { status: 429 });
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const body = rawBody as { input?: unknown; config?: unknown; previewToken?: unknown; imageDataUrl?: unknown };
    const input = createGameSchema.parse(body.input);
    if (typeof body.previewToken !== "string" || !body.previewToken) {
      return NextResponse.json({ error: "Generate a fresh preview before saving." }, { status: 400 });
    }
    const imageDataUrl = body.imageDataUrl;
    if (typeof imageDataUrl !== "string" || !imageDataUrl) return NextResponse.json({ error: "A PNG, JPEG, or WebP token image is required." }, { status: 400 });
    const config = body.config === undefined
      ? generateGameConfig(input)
      : validateGameConfigForInput(input, body.config);
    const frozen = freezeGameVersion(config);
    verifyPreviewToken(body.previewToken, input, frozen);
    const generation: GameGenerationMetadata = config.generation || {
      mode: "deterministic" as const,
      provider: "pons",
      model: frozen.runtimeVersion,
      version: "blueprint-v1" as const,
      attempts: 0,
      attemptedModels: [],
    };
    const developerBuyEth = input.developerBuyEth || "0";
    if (developerBuyEth.length > 32 || !/^\d+(?:\.\d{0,6})?$/.test(developerBuyEth)) {
      return NextResponse.json({ error: "Enter a valid developer buy amount." }, { status: 400 });
    }
    const developerBuyWei = parseEther(developerBuyEth).toString();
    const suffix = sha256(`${userId}:${frozen.deterministicId}:${Date.now()}`).slice(0, 6);
    const slug = `${slugify(input.name) || "game"}-${suffix}`;
    const result = await transaction(async (client) => {
      const game = await client.query<{ id: string }>(
        `INSERT INTO games(owner_user_id,slug,name,ticker,description,category,visual_style,difficulty,prompt,website_url,x_url,developer_buy_wei,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PREVIEW_READY') RETURNING id`,
        [userId, slug, input.name, input.ticker, input.description, input.category, input.visualStyle, input.difficulty, input.prompt, input.websiteUrl || null, input.xUrl || null, developerBuyWei],
      );
      const gameId = game.rows[0].id;
      const imageId = await saveTokenImage(client, { userId, gameId, dataUrl: imageDataUrl });
      // The signed preview token binds this job ID through the frozen config hash.
      // Claim it for the verified X user so an anonymous pre-login preview survives OAuth.
      const job = generation.jobId
        ? await client.query<{ id: string }>(
            `UPDATE generation_jobs SET game_id=$2,user_id=$3,updated_at=now()
             WHERE id=$1 AND game_id IS NULL AND status='SUCCEEDED' AND input_hash=$4 AND output_hash=$5
             RETURNING id`,
            [generation.jobId, gameId, userId, previewInputHash(input), frozen.manifestHash],
          )
        : await client.query<{ id: string }>(
            `INSERT INTO generation_jobs(user_id,game_id,status,progress,input_hash,output_hash,provider,model,attempts,error_code)
             VALUES($1,$2,'SUCCEEDED',100,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [userId, gameId, previewInputHash(input), frozen.manifestHash, generation.provider, generation.model, generation.attempts, generation.failureCode || null],
          );
      if (!job.rows[0]) throw new Error("GENERATION_JOB_NOT_AVAILABLE");
      await client.query(
        `INSERT INTO game_drafts(game_id,revision,prompt,config,generation_job_id) VALUES($1,1,$2,$3::jsonb,$4)`,
        [gameId, input.prompt, frozen.configJson, job.rows[0].id],
      );
      const version = await client.query<{ id: string }>(
        `INSERT INTO game_versions(game_id,version_number,deterministic_id,template_version,runtime_version,config,config_hash,manifest_hash,document_html,prompt,release_notes,status,created_by)
         VALUES($1,1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'Initial playable preview.','PREVIEW',$10) RETURNING id`,
        [gameId, `${frozen.deterministicId}-${suffix}`, frozen.templateVersion, frozen.runtimeVersion, frozen.configJson, frozen.configHash, frozen.manifestHash, frozen.documentHtml, input.prompt, userId],
      );
      await client.query("UPDATE games SET current_version_id=$1 WHERE id=$2", [version.rows[0].id, gameId]);
      await client.query(
        `INSERT INTO audit_logs(actor_user_id,actor_type,action,resource_type,resource_id,request_id,ip_hash,after_data)
         VALUES($1,'USER','GAME_CREATED','GAME',$2,$3,$4,$5::jsonb)`,
        [userId, gameId, request.headers.get("x-request-id") || crypto.randomUUID(), hashIp(requestIp(request.headers)), JSON.stringify({ versionId: version.rows[0].id, imageId })],
      );
      return { gameId, versionId: version.rows[0].id, imageId, slug };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PreviewTokenError) {
      const message = error.code === "EXPIRED"
        ? "This preview expired. Generate it again before saving."
        : error.code === "MISMATCH"
          ? "The game details changed after this preview. Generate a new preview before saving."
          : "This preview could not be verified. Generate a fresh preview before saving.";
      return NextResponse.json({ error: message }, { status: error.code === "MISMATCH" ? 409 : 400 });
    }
    if (error instanceof PreviewTokenConfigurationError) {
      return NextResponse.json({ error: "Preview verification is temporarily unavailable." }, { status: 503 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Check the game details and try again." }, { status: 400 });
    }
    if (error instanceof Error && error.message === "GENERATED_CONFIG_MISMATCH") {
      return NextResponse.json({ error: "The generated game no longer matches these details. Generate a fresh preview." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "GENERATION_JOB_NOT_AVAILABLE") {
      return NextResponse.json({ error: "This preview was already saved or is no longer available. Generate a fresh preview." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "INVALID_ORIGIN") {
      return NextResponse.json({ error: "Request origin not allowed." }, { status: 403 });
    }
    if (error instanceof Error && error.message.startsWith("Prompt rejected:")) {
      return NextResponse.json({ error: "The game prompt could not be accepted." }, { status: 400 });
    }
    if (error instanceof Error && IMAGE_ERROR_MESSAGES[error.message]) {
      return NextResponse.json({ error: IMAGE_ERROR_MESSAGES[error.message] }, { status: 400 });
    }
    console.error("game_create_failed", unexpectedFailureMetadata(error));
    return NextResponse.json({ error: "Could not save the game right now. Try again." }, { status: 500 });
  }
}
