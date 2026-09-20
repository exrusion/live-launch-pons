import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData } from "viem";
import { freezeGameVersion, gameConfigSchema, generateGameConfig, validateGameConfigForInput, versionIdentity } from "@/lib/game-generator";
import { buildFrozenGameDocument, buildGameDocument, FROZEN_GAME_DOCUMENT_NONCE, FROZEN_GAME_DOCUMENT_VERSION } from "@/lib/game-runtime";
import { buildPonsParams, launchCalldata } from "@/lib/pons";
import { PONS_FACTORY_ABI } from "@/lib/pons-abi";
import { validateReplay } from "@/lib/scores";
import { moderateText, sha256 } from "@/lib/security";
import { nextSponsorNonce, rebateRequiredBalance } from "@/lib/rebates";
import { applyPreviewNonce } from "@/lib/preview-html";

const input = {
  name: "Neon Burrow",
  ticker: "BURROW",
  description: "A tiny arcade chase through a neural lab.",
  prompt: "Make a fast cyber mouse runner in a neural laboratory with neuron collectibles",
  category: "RUNNER" as const,
  visualStyle: "neon pixel",
  difficulty: "NORMAL" as const,
  developerBuyEth: "0",
  xUrl: "",
  websiteUrl: "",
};

test("game generation is deterministic and prompt-derived", () => {
  const first = generateGameConfig(input);
  const second = generateGameConfig(input);
  assert.deepEqual(first, second);
  assert.equal(first.category, "RUNNER");
  assert.match(first.story, /cyber mouse/i);
  assert.match(first.story, /neural lab/i);
  assert.equal(versionIdentity(first).manifestHash, versionIdentity(second).manifestHash);
});

test("unsafe executable prompts are rejected", () => {
  assert.equal(moderateText("<script>document.cookie</script>").ok, false);
  assert.equal(moderateText("a friendly frog arcade game").ok, true);
});

test("sandbox document blocks network access and contains a playable runtime", () => {
  const config = generateGameConfig(input);
  const html = buildGameDocument(config, { nonce: "test-nonce", versionId: "version-1" });
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /worker-src 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.match(html, /script-src 'nonce-test-nonce'/);
  assert.match(html, /<canvas id="stage"/);
  assert.match(html, /pons-game/);
  assert.match(html, /mech\.spawnRate/);
  assert.match(html, /mech\.worldPattern/);
  assert.doesNotMatch(html, /<script[^>]*src=/);
});

test("AI-directed configuration remains strict and bound to the requested game", () => {
  const baseline = generateGameConfig(input);
  const aiConfig = gameConfigSchema.parse({
    ...baseline,
    story: "A hand-authored AI blueprint for the same protected arcade runtime.",
    generation: { mode: "ai", provider: "gateway.example", model: "fast-code-model", version: "blueprint-v1", attempts: 1, attemptedModels: ["fast-code-model"] },
  });
  assert.deepEqual(validateGameConfigForInput(input, aiConfig), aiConfig);
  assert.throws(() => validateGameConfigForInput(input, { ...aiConfig, title: "Swapped title" }), /GENERATED_CONFIG_MISMATCH/);
  assert.throws(() => gameConfigSchema.parse({ ...aiConfig, speed: 99 }));
  assert.throws(() => gameConfigSchema.parse({ ...aiConfig, story: "<script>window.ethereum</script>" }));
  assert.throws(() => gameConfigSchema.parse({
    ...aiConfig,
    mechanics: { ...aiConfig.mechanics, gravity: 1.2, jumpPower: 0.8, obstacleScale: 1.3 },
  }), /Runner mechanics are not clearable/);
});

test("frozen preview documents are deterministic and the manifest binds every byte", () => {
  const config = generateGameConfig(input);
  const first = freezeGameVersion(config);
  const second = freezeGameVersion(config);
  const rebuilt = buildFrozenGameDocument(config);

  assert.equal(first.documentHtml, second.documentHtml);
  assert.equal(first.documentHtml, rebuilt);
  assert.equal(first.manifestHash, sha256(first.documentHtml));
  assert.equal(versionIdentity(config).manifestHash, first.manifestHash);
  assert.equal(FROZEN_GAME_DOCUMENT_NONCE, "cG9ucy1mcm96ZW4tcnVudGltZS12Mg==");
  assert.match(first.documentHtml, new RegExp(`nonce="${FROZEN_GAME_DOCUMENT_NONCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(first.documentHtml, new RegExp(`versionId:${JSON.stringify(FROZEN_GAME_DOCUMENT_VERSION)}`));

  const runtimeMutation = `${first.documentHtml}\n<!-- runtime mutation -->`;
  assert.notEqual(sha256(runtimeMutation), first.manifestHash);
});

test("srcdoc previews use the request CSP nonce without mutating frozen bytes", () => {
  const frozen = buildFrozenGameDocument(generateGameConfig(input));
  const display = applyPreviewNonce(frozen, "requestnonce123")!;
  assert.match(display, /script-src 'nonce-requestnonce123'/);
  assert.match(display, /style-src 'nonce-requestnonce123'/);
  assert.match(display, /<script nonce="requestnonce123">/);
  assert.match(display, /<style nonce="requestnonce123">/);
  assert.match(frozen, new RegExp(FROZEN_GAME_DOCUMENT_NONCE));
  assert.doesNotMatch(frozen, /requestnonce123/);
});

test("replay validation accepts plausible runs and rejects impossible scores", () => {
  const plausible = validateReplay({
    category: "RUNNER",
    score: 500,
    durationMs: 5_000,
    events: [{ t: 200, type: "jump" }, { t: 850, type: "jump" }],
    seedHash: "seed",
  });
  assert.equal(plausible.valid, true);
  assert.equal(typeof plausible.replayHash, "string");
  const impossible = validateReplay({ category: "FLAPPY", score: 99_999, durationMs: 1_000, events: [], seedHash: "seed" });
  assert.deepEqual(impossible, { valid: false, reason: "SCORE_REPLAY_MISMATCH", computedScore: 0 });
});

test("mobile shooter movement and hit events produce a server-checkable score", () => {
  const replay = validateReplay({
    category: "SHOOTER",
    score: 90,
    durationMs: 5_000,
    events: [
      { t: 100, type: "move", x: 120, y: 400 },
      { t: 800, type: "fire", x: 700, y: 120 },
      { t: 1_050, type: "hit" },
    ],
    seedHash: "seed",
  });
  assert.equal(replay.valid, true);
  assert.equal(replay.computedScore, 90);
});

test("replay limits follow the signed high-tempo mechanics", () => {
  const mechanics = {
    ...generateGameConfig(input).mechanics,
    spawnRate: 1.3,
    collectibleRate: 1.4,
  };
  const runner = validateReplay({
    category: "RUNNER",
    score: 594,
    durationMs: 3_000,
    events: [1_800, 2_050, 2_300, 2_550].map((t) => ({ t, type: "collect" })),
    seedHash: "runner",
    speed: 1.35,
    difficulty: "HARD",
    mechanics,
  });
  assert.equal(runner.valid, true);

  const flappy = validateReplay({
    category: "FLAPPY",
    score: 300,
    durationMs: 3_000,
    events: [1_650, 2_270, 2_890].map((t) => ({ t, type: "gate" })),
    seedHash: "flappy",
    speed: 1.35,
    difficulty: "HARD",
    mechanics,
  });
  assert.equal(flappy.valid, true);

  const shooterEvents = [300, 520, 740, 960].flatMap((t) => [
    { t: t - 50, type: "fire", x: 600, y: 120 },
    { t, type: "hit" },
  ]);
  const shooter = validateReplay({
    category: "SHOOTER",
    score: 208,
    durationMs: 1_000,
    events: shooterEvents,
    seedHash: "shooter",
    speed: 1.35,
    difficulty: "HARD",
    mechanics,
  });
  assert.equal(shooter.valid, true);

  assert.equal(validateReplay({
    category: "RUNNER",
    score: 25,
    durationMs: 1_000,
    events: [{ t: 200, type: "collect" }],
    seedHash: "forged",
    speed: 1.35,
    difficulty: "HARD",
    mechanics,
  }).reason, "COLLECT_BEFORE_SPAWN");
});

test("Pons launch calldata round-trips the immutable metadata", () => {
  const creator = "0x1111111111111111111111111111111111111111";
  const params = buildPonsParams({
    launchId: "launch-1",
    versionId: "version-1",
    name: "Neon Burrow",
    symbol: "BURROW",
    logo: "https://example.com/token.png",
    description: "A tiny arcade chase.",
    creator,
    expectedEconomics: `0x${"22".repeat(32)}`,
  });
  const data = launchCalldata(params, 0n);
  const decoded = decodeFunctionData({ abi: PONS_FACTORY_ABI, data });
  assert.equal(decoded.functionName, "launchToken");
  assert.equal(decoded.args[1], 0n);
  assert.equal(decoded.args[0].symbol, "BURROW");
  assert.equal(decoded.args[0].creatorFeeRecipient, creator);
});

test("rebate accounting includes gas and reserves nonces monotonically", () => {
  assert.equal(rebateRequiredBalance(500n, 21_000n, 2n), 42_500n);
  assert.equal(nextSponsorNonce(7, null), 7);
  assert.equal(nextSponsorNonce(7, "9"), 10);
  assert.equal(nextSponsorNonce(12, "9"), 12);
  assert.throws(() => rebateRequiredBalance(-1n, 21_000n, 2n), /INVALID_REBATE_COST/);
});
