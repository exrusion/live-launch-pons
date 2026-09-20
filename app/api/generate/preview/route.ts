import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { acquireAiGenerationLease } from "@/lib/ai-budget";
import { aiConfigurationStatus, generateGameConfigWithAi } from "@/lib/ai-game-generator";
import { attachCreatorCookie, ensureCreator } from "@/lib/auth";
import { createGameSchema, freezeGameVersion, gameConfigSchema, generateGameConfig } from "@/lib/game-generator";
import { query } from "@/lib/db";
import { issuePreviewToken, previewInputHash, PreviewTokenConfigurationError } from "@/lib/preview-token";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashIp, requestIp, requireSameOrigin } from "@/lib/security";

const MAX_PREVIEW_REQUEST_BYTES = 16 * 1024;

async function readJsonBody(request: NextRequest) {
  const declaredLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PREVIEW_REQUEST_BYTES) throw new Error("REQUEST_TOO_LARGE");
  if (!request.body) throw new Error("INVALID_JSON");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let raw = "";
  let timedOut = false;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  const timer = setTimeout(() => { timedOut = true; cancel(); }, 3_000);
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_PREVIEW_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("REQUEST_TOO_LARGE");
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
  }
  if (timedOut) throw new Error("REQUEST_TIMEOUT");
  try {
    return JSON.parse(raw + decoder.decode()) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

export async function POST(request: NextRequest) {
  let generationJobId: string | undefined;
  try {
    if (!request.headers.get("origin")) throw new Error("INVALID_ORIGIN");
    requireSameOrigin(request);
    const ip = hashIp(requestIp(request.headers));
    const burst = await checkRateLimit(`preview-burst:${ip}`, 3, 60);
    if (!burst.allowed) return NextResponse.json({ error: "Too many previews. Wait a minute and try again." }, { status: 429 });
    const hourly = await checkRateLimit(`preview-hourly:${ip}`, 8, 60 * 60);
    if (!hourly.allowed) return NextResponse.json({ error: "Preview limit reached. Try again later." }, { status: 429 });
    const input = createGameSchema.parse(await readJsonBody(request));
    // Complete local moderation/validation before reserving shared paid capacity.
    generateGameConfig(input);
    const creator = await ensureCreator(request);
    const session = creator.session;
    const aiStatus = aiConfigurationStatus();
    let generated: Awaited<ReturnType<typeof generateGameConfigWithAi>>;
    if (session?.user?.id && aiStatus.valid && aiStatus.config) {
      const provider = new URL(aiStatus.config.baseUrl).hostname.slice(0, 96);
      const job = await query<{ id: string }>(
        `INSERT INTO generation_jobs(user_id,status,progress,input_hash,provider,model,attempts)
         VALUES($1,'GENERATING',5,$2,$3,$4,0) RETURNING id`,
        [session.user.id, previewInputHash(input), provider, aiStatus.config.model],
      );
      generationJobId = job.rows[0].id;
      const lease = await acquireAiGenerationLease(session.user.id);
      try {
        if (!lease.allowed) console.warn("ai_generation_skipped", { reason: lease.reason });
        generated = await generateGameConfigWithAi(input, { config: lease.allowed ? aiStatus.config : null });
        if (!lease.allowed) {
          generated.config = gameConfigSchema.parse({
            ...generated.config,
            generation: {
              mode: "fallback",
              provider,
              model: aiStatus.config.model,
              version: "blueprint-v1",
              attempts: 0,
              attemptedModels: [],
              failureCode: `BUDGET_${lease.reason.toUpperCase().replaceAll("-", "_")}`,
            },
          });
        }
      } finally {
        await lease.release();
      }
    } else {
      generated = await generateGameConfigWithAi(input, { config: null });
    }
    const config = generationJobId
      ? gameConfigSchema.parse({
          ...generated.config,
          generation: { ...generated.config.generation!, jobId: generationJobId },
        })
      : generated.config;
    if (generated.outcome.mode === "fallback") {
      console.warn("ai_generation_fallback", {
        model: generated.outcome.attemptedModel,
        code: generated.outcome.code,
      });
    }
    const frozen = freezeGameVersion(config);
    const { documentHtml: previewHtml, ...version } = frozen;
    const previewToken = issuePreviewToken(input, version);
    if (generationJobId) {
      await query(
        `UPDATE generation_jobs SET status='SUCCEEDED',progress=100,output_hash=$2,provider=$3,model=$4,attempts=$5,error_code=$6,updated_at=now()
         WHERE id=$1`,
        [generationJobId, frozen.manifestHash, config.generation!.provider, config.generation!.model, config.generation!.attempts, config.generation!.failureCode || null],
      );
    }
    return attachCreatorCookie(NextResponse.json(
      { config, generation: config.generation, version, previewHtml, previewToken },
      { headers: { "Cache-Control": "no-store" } },
    ), creator.cookie);
  } catch (error) {
    if (generationJobId) {
      await query(
        "UPDATE generation_jobs SET status='FAILED',progress=100,error_code='PREVIEW_FAILED',updated_at=now() WHERE id=$1 AND status<>'SUCCEEDED'",
        [generationJobId],
      ).catch(() => undefined);
    }
    if (error instanceof PreviewTokenConfigurationError) {
      return NextResponse.json({ error: "Preview service is temporarily unavailable." }, { status: 503 });
    }
    if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
      return NextResponse.json({ error: "Game details are too large." }, { status: 413 });
    }
    if (error instanceof Error && error.message === "INVALID_ORIGIN") {
      return NextResponse.json({ error: "Request origin not allowed." }, { status: 403 });
    }
    if (error instanceof Error && error.message === "INVALID_JSON") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    if (error instanceof Error && error.message === "REQUEST_TIMEOUT") {
      return NextResponse.json({ error: "Request body timed out." }, { status: 408 });
    }
    if (error instanceof ZodError || (error instanceof Error && error.message.startsWith("Prompt rejected:"))) {
      return NextResponse.json({ error: "Check the game details and try again." }, { status: 400 });
    }
    console.error("preview_generation_failed", { errorClass: error instanceof Error ? error.constructor.name : "UnknownError" });
    return NextResponse.json({ error: "Could not generate the preview right now. Try again." }, { status: 500 });
  }
}
