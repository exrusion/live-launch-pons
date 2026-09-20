import assert from "node:assert/strict";
import test from "node:test";
import { createGameSchema, generateGameConfig, versionIdentity } from "@/lib/game-generator";
import { issuePreviewToken, PreviewTokenError, verifyPreviewToken } from "@/lib/preview-token";

const SECRET = "test-only-preview-secret-with-enough-entropy";
const ISSUED_AT = 1_700_000_000;
const input = {
  name: "Neon Burrow",
  ticker: "burrow",
  description: "A tiny arcade chase through a neural lab.",
  prompt: "Make a fast cyber mouse runner in a neural laboratory with neuron collectibles",
  category: "RUNNER" as const,
  visualStyle: "neon pixel",
  difficulty: "NORMAL" as const,
  developerBuyEth: "0",
  xUrl: "",
  websiteUrl: "",
};

function previewFor(value: typeof input = input) {
  const parsed = createGameSchema.parse(value);
  const identity = versionIdentity(generateGameConfig(parsed));
  const token = issuePreviewToken(parsed, identity, { now: ISSUED_AT, secret: SECRET });
  return { parsed, identity, token };
}

function errorCode(action: () => unknown) {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof PreviewTokenError);
    return error.code;
  }
  assert.fail("Expected preview-token verification to fail");
}

test("preview token verifies the exact canonical parsed input and generated version", () => {
  const { parsed, identity, token } = previewFor();
  const reordered = {
    websiteUrl: parsed.websiteUrl,
    difficulty: parsed.difficulty,
    prompt: parsed.prompt,
    name: ` ${parsed.name} `,
    visualStyle: parsed.visualStyle,
    category: parsed.category,
    ticker: parsed.ticker.toLowerCase(),
    description: parsed.description,
    xUrl: parsed.xUrl,
    developerBuyEth: parsed.developerBuyEth,
  };
  const payload = verifyPreviewToken(token, reordered, identity, { now: ISSUED_AT + 60, secret: SECRET });
  assert.equal(payload.v, 1);
  assert.equal(payload.exp - payload.iat, 24 * 60 * 60);
});

test("tampered preview tokens are rejected", () => {
  const { parsed, identity, token } = previewFor();
  const [prefix, payload, signature] = token.split(".");
  const tamperedPayload = `${prefix}.${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}.${signature}`;
  const tamperedSignature = `${prefix}.${payload}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
  assert.equal(errorCode(() => verifyPreviewToken(tamperedPayload, parsed, identity, { now: ISSUED_AT + 1, secret: SECRET })), "INVALID");
  assert.equal(errorCode(() => verifyPreviewToken(tamperedSignature, parsed, identity, { now: ISSUED_AT + 1, secret: SECRET })), "INVALID");
  assert.equal(errorCode(() => verifyPreviewToken(token, parsed, identity, { now: ISSUED_AT + 1, secret: `${SECRET}-wrong` })), "INVALID");
  assert.equal(errorCode(() => verifyPreviewToken(`${prefix}.${payload}.${signature.slice(0, -2)}`, parsed, identity, { now: ISSUED_AT + 1, secret: SECRET })), "INVALID");
});

test("preview tokens expire after exactly 24 hours", () => {
  const { parsed, identity, token } = previewFor();
  verifyPreviewToken(token, parsed, identity, { now: ISSUED_AT + 86_399, secret: SECRET });
  assert.equal(errorCode(() => verifyPreviewToken(token, parsed, identity, { now: ISSUED_AT + 86_400, secret: SECRET })), "EXPIRED");
});

test("changed input or generated identities cannot reuse an earlier preview", () => {
  const { parsed, identity, token } = previewFor();
  const changedInput = { ...parsed, description: "A different game description that was not previewed." };
  assert.equal(errorCode(() => verifyPreviewToken(token, changedInput, identity, { now: ISSUED_AT + 1, secret: SECRET })), "MISMATCH");

  const changedConfig = { ...identity, configHash: "a".repeat(64) };
  assert.equal(errorCode(() => verifyPreviewToken(token, parsed, changedConfig, { now: ISSUED_AT + 1, secret: SECRET })), "MISMATCH");

  const changedManifest = { ...identity, manifestHash: "b".repeat(64) };
  assert.equal(errorCode(() => verifyPreviewToken(token, parsed, changedManifest, { now: ISSUED_AT + 1, secret: SECRET })), "MISMATCH");
});

test("missing and malformed preview tokens are rejected", () => {
  const { parsed, identity } = previewFor();
  assert.equal(errorCode(() => verifyPreviewToken("", parsed, identity, { now: ISSUED_AT, secret: SECRET })), "INVALID");
  assert.equal(errorCode(() => verifyPreviewToken("pv2.payload.signature", parsed, identity, { now: ISSUED_AT, secret: SECRET })), "INVALID");
  assert.equal(errorCode(() => verifyPreviewToken("pv1.not+base64.signature", parsed, identity, { now: ISSUED_AT, secret: SECRET })), "INVALID");
  assert.equal(errorCode(() => verifyPreviewToken(`pv1.${"a".repeat(2_049)}.signature`, parsed, identity, { now: ISSUED_AT, secret: SECRET })), "INVALID");
});

test("semantically omitted optional fields bind to their parsed defaults", () => {
  const withoutOptionals = {
    name: input.name,
    ticker: input.ticker,
    description: input.description,
    prompt: input.prompt,
    category: input.category,
    visualStyle: input.visualStyle,
    difficulty: input.difficulty,
  };
  const parsed = createGameSchema.parse(withoutOptionals);
  const identity = versionIdentity(generateGameConfig(parsed));
  const token = issuePreviewToken(withoutOptionals, identity, { now: ISSUED_AT, secret: SECRET });
  verifyPreviewToken(token, { ...withoutOptionals, developerBuyEth: "0", xUrl: "", websiteUrl: "" }, identity, { now: ISSUED_AT + 1, secret: SECRET });
});

test("tokens issued too far in the future fail closed", () => {
  const { parsed, identity } = previewFor();
  const token = issuePreviewToken(parsed, identity, { now: ISSUED_AT + 301, secret: SECRET });
  assert.equal(errorCode(() => verifyPreviewToken(token, parsed, identity, { now: ISSUED_AT, secret: SECRET })), "INVALID");
});
