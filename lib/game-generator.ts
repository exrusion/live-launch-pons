import { z } from "zod";
import type { CreateGameInput, GameConfig } from "@/lib/types";
import { buildFrozenGameDocument, GAME_RUNTIME_VERSION, gameTemplateVersion } from "@/lib/game-runtime";
import { canonicalJson, moderateText, sha256 } from "@/lib/security";

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

  return {
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
  };
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
