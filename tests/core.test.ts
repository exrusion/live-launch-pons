import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData } from "viem";
import { generateGameConfig, versionIdentity } from "@/lib/game-generator";
import { buildGameDocument } from "@/lib/game-runtime";
import { buildPonsParams, launchCalldata } from "@/lib/pons";
import { PONS_FACTORY_ABI } from "@/lib/pons-abi";
import { validateReplay } from "@/lib/scores";
import { moderateText } from "@/lib/security";
import { nextSponsorNonce, rebateRequiredBalance } from "@/lib/rebates";

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
  assert.match(html, /script-src 'nonce-test-nonce'/);
  assert.match(html, /<canvas id="stage"/);
  assert.match(html, /pons-game/);
  assert.doesNotMatch(html, /<script[^>]*src=/);
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
