import { z } from "zod";
import type { CreateGameInput, GameConfig } from "@/lib/types";
import { buildFrozenGameDocument, GAME_RUNTIME_VERSION, gameTemplateVersion } from "@/lib/game-runtime";
import { canonicalJson, moderateText, sha256 } from "@/lib/security";

export const GAME_BLUEPRINT_VERSION = "blueprint-v1" as const;

const safeGeneratedText = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u001f<>]/u.test(value), "Unsafe generated text");
const generatedIdentifier = z.string().trim().min(1).max(96).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const entitySchema = z.object({
  shape: safeGeneratedText(1, 48),
  label: safeGeneratedText(1, 48),
}).strict();

export const gameGenerationMetadataSchema = z.object({
  mode: z.enum(["ai", "deterministic", "fallback"]),
  provider: generatedIdentifier,
  model: generatedIdentifier,
  version: z.literal(GAME_BLUEPRINT_VERSION),
  attempts: z.number().int().min(0).max(2),
  attemptedModels: z.array(generatedIdentifier).max(2),
  failureCode: generatedIdentifier.optional(),
  jobId: z.string().uuid().optional(),
}).strict();

export const gameMechanicsSchema = z.object({
  worldPattern: z.enum(["grid", "stars", "circuit", "waves"]),
  playerForm: z.enum(["runner", "orb", "ship", "bot"]),
  obstacleForm: z.enum(["barrier", "spike", "drone", "meteor"]),
  collectibleForm: z.enum(["shard", "star", "crystal", "neuron"]),
  gravity: z.number().finite().min(0.8).max(1.2),
  jumpPower: z.number().finite().min(0.8).max(1.2),
  spawnRate: z.number().finite().min(0.75).max(1.3),
  collectibleRate: z.number().finite().min(0.7).max(1.4),
  obstacleScale: z.number().finite().min(0.75).max(1.3),
  enemyAggression: z.number().finite().min(0.75).max(1.3),
  projectileSpeed: z.number().finite().min(0.8).max(1.25),
}).strict();

export const gameConfigSchema = z.object({
  category: z.enum(["RUNNER", "FLAPPY", "SHOOTER"]),
  title: safeGeneratedText(2, 48),
  instructions: safeGeneratedText(8, 180),
  story: safeGeneratedText(8, 280),
  palette: z.object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    danger: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }).strict(),
  character: entitySchema,
  obstacle: entitySchema,
  collectible: entitySchema,
  difficulty: z.enum(["EASY", "NORMAL", "HARD"]),
  speed: z.number().finite().min(0.7).max(1.35),
  soundStyle: z.enum(["arcade", "soft", "silent"]),
  seed: z.number().int().min(0).max(0xffff_ffff),
  mechanics: gameMechanicsSchema,
  generation: gameGenerationMetadataSchema.optional(),
}).strict().superRefine((config, context) => {
  if (config.category === "RUNNER") {
    const jumpClearance = (650 * config.mechanics.jumpPower) ** 2 / (2 * 1800 * config.mechanics.gravity) + 4;
    const tallestObstacle = 119 * config.mechanics.obstacleScale;
    if (tallestObstacle > jumpClearance) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["mechanics"], message: "Runner mechanics are not clearable" });
    }
  }
  if (config.category === "SHOOTER") {
    const difficulty = config.difficulty === "HARD" ? 1.22 : config.difficulty === "EASY" ? 0.84 : 1;
    const threat = config.speed * difficulty * config.mechanics.spawnRate * config.mechanics.enemyAggression;
    if (threat > 2.45) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["mechanics"], message: "Shooter mechanics exceed the fair threat budget" });
    }
  }
});

export const createGameSchema = z.object({
  name: z.string().trim().min(2).max(48),
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/),
  description: z.string().trim().min(8).max(280),
  prompt: z.string().trim().min(15).max(900),
  category: z.enum(["RUNNER", "FLAPPY", "SHOOTER"]),
  visualStyle: z.string().trim().min(2).max(48),
  difficulty: z.enum(["EASY", "NORMAL", "HARD"]),
  developerBuyEth: z.string().trim().max(32).regex(/^\d+(?:\.\d{0,6})?$/).optional().default("0"),
  xUrl: z.string().url().max(200).optional().or(z.literal("")),
  websiteUrl: z.string().url().max(200).optional().or(z.literal("")),
});

const palettes = [
  { background: "#07110d", primary: "#74ff9a", accent: "#ffda57", danger: "#ff5577", text: "#f4fff7" },
  { background: "#080a18", primary: "#8cf3ff", accent: "#c7ff55", danger: "#ff5d8f", text: "#f5f7ff" },
  { background: "#13091d", primary: "#d58cff", accent: "#62ffbb", danger: "#ff6f61", text: "#fff8ff" },
  { background: "#160d08", primary: "#ffb25f", accent: "#86ffef", danger: "#ff5470", text: "#fff9f2" },
];

function words(prompt: string): string[] {
  return prompt.toLowerCase().match(/[a-z0-9]+/g) || [];
}

function chooseLabel(prompt: string, candidates: Array<[RegExp, string]>, fallback: string) {
  return candidates.find(([pattern]) => pattern.test(prompt))?.[1] || fallback;
}

export function generateGameConfig(input: CreateGameInput): GameConfig {
  const parsed = createGameSchema.parse(input);
  const moderation = moderateText(parsed.prompt);
  if (!moderation.ok) throw new Error(`Prompt rejected: ${moderation.code}`);
  const prompt = moderation.text;
  const hash = sha256(`${parsed.category}:${parsed.difficulty}:${prompt}:${parsed.visualStyle}`);
  const palette = palettes[Number.parseInt(hash.slice(0, 2), 16) % palettes.length];
  const speed = parsed.difficulty === "EASY" ? 0.84 : parsed.difficulty === "HARD" ? 1.22 : 1;
  const character = chooseLabel(
    prompt,
    [[/mouse|mice/, "cyber mouse"], [/cat|kitten/, "arcade cat"], [/robot|android/, "mini robot"], [/frog/, "neon frog"], [/ship|pilot/, "star pilot"]],
    parsed.category === "SHOOTER" ? "star pilot" : "pixel runner",
  );
  const obstacle = chooseLabel(
    prompt,
    [[/drone/, "security drone"], [/cat/, "robotic cat"], [/meteor|asteroid/, "meteor"], [/laser/, "laser gate"], [/ghost/, "glitch ghost"]],
    parsed.category === "FLAPPY" ? "energy gate" : "glitch barrier",
  );
  const collectible = chooseLabel(
    prompt,
    [[/neuron/, "neuron"], [/coin|gold/, "coin"], [/star/, "star"], [/crystal/, "crystal"], [/battery|energy/, "energy cell"]],
    "data shard",
  );
  const promptWords = words(prompt);
  const place = promptWords.includes("mars") ? "Mars" : promptWords.includes("lab") || promptWords.includes("laboratory") ? "the neural lab" : promptWords.includes("space") ? "deep space" : "a shifting arcade world";
  const worldPattern = /space|star|cosmic/i.test(`${prompt} ${parsed.visualStyle}`)
    ? "stars"
    : /lab|cyber|neon|circuit/i.test(`${prompt} ${parsed.visualStyle}`)
      ? "circuit"
      : /water|ocean|wave/i.test(prompt)
        ? "waves"
        : "grid";
  const playerForm = /ship|pilot/i.test(character) ? "ship" : /robot|android/i.test(character) ? "bot" : /orb|ball/i.test(prompt) ? "orb" : "runner";
  const obstacleForm = /drone/i.test(obstacle) ? "drone" : /meteor|asteroid/i.test(obstacle) ? "meteor" : /spike/i.test(prompt) ? "spike" : "barrier";
  const collectibleForm = /neuron/i.test(collectible) ? "neuron" : /star/i.test(collectible) ? "star" : /crystal/i.test(collectible) ? "crystal" : "shard";

  return gameConfigSchema.parse({
    category: parsed.category,
    title: parsed.name,
    instructions:
      parsed.category === "RUNNER"
        ? `Tap, click, or press Space to jump. Collect every ${collectible}.`
        : parsed.category === "FLAPPY"
          ? "Tap, click, or press Space to fly through each opening."
          : "Drag on the left to move. Tap the right to fire. Keyboard: WASD or arrows.",
    story: `${character[0].toUpperCase()}${character.slice(1)} enters ${place}. Avoid ${obstacle}s and keep the run alive.`,
    palette,
    character: { shape: character, label: character },
    obstacle: { shape: obstacle, label: obstacle },
    collectible: { shape: collectible, label: collectible },
    difficulty: parsed.difficulty,
    speed,
    soundStyle: /silent|no sound|mute/i.test(prompt) ? "silent" : /calm|soft|lofi/i.test(prompt) ? "soft" : "arcade",
    seed: Number.parseInt(hash.slice(0, 8), 16) >>> 0,
    mechanics: {
      worldPattern,
      playerForm,
      obstacleForm,
      collectibleForm,
      gravity: 1,
      jumpPower: 1,
      spawnRate: 1,
      collectibleRate: 1,
      obstacleScale: 1,
      enemyAggression: 1,
      projectileSpeed: 1,
    },
    generation: {
      mode: "deterministic",
      provider: "pons",
      model: GAME_RUNTIME_VERSION,
      version: GAME_BLUEPRINT_VERSION,
      attempts: 0,
      attemptedModels: [],
    },
  });
}

export function validateGameConfigForInput(input: CreateGameInput, value: unknown): GameConfig {
  const parsedInput = createGameSchema.parse(input);
  const config = gameConfigSchema.parse(value);
  const baseline = generateGameConfig(parsedInput);
  if (
    config.title !== parsedInput.name ||
    config.category !== parsedInput.category ||
    config.difficulty !== parsedInput.difficulty ||
    config.seed !== baseline.seed
  ) {
    throw new Error("GENERATED_CONFIG_MISMATCH");
  }
  return config;
}

export function freezeGameVersion(config: GameConfig) {
  const configJson = canonicalJson(config);
  const configHash = sha256(configJson);
  const documentHtml = buildFrozenGameDocument(config);
  const manifestHash = sha256(documentHtml);
  return {
    configJson,
    configHash,
    manifestHash,
    deterministicId: `v2-${manifestHash.slice(0, 24)}`,
    templateVersion: gameTemplateVersion(config),
    runtimeVersion: GAME_RUNTIME_VERSION,
    documentHtml,
  };
}

export function versionIdentity(config: GameConfig) {
  const { documentHtml: _, ...identity } = freezeGameVersion(config);
  return identity;
}
