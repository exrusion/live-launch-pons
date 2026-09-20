import { createHmac, timingSafeEqual } from "node:crypto";
import { createGameSchema } from "@/lib/game-generator";
import { canonicalJson, sha256 } from "@/lib/security";

const TOKEN_PREFIX = "pv1";
const TOKEN_VERSION = 1;
const TOKEN_TTL_SECONDS = 24 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

type PreviewIdentity = {
  configHash: string;
  manifestHash: string;
};

type PreviewBinding = PreviewIdentity & {
  inputHash: string;
};

type PreviewTokenPayload = PreviewBinding & {
  v: typeof TOKEN_VERSION;
  iat: number;
  exp: number;
};

type TokenOptions = {
  /** Unix timestamp in seconds. Intended for deterministic tests. */
  now?: number;
  /** Overrides NEXTAUTH_SECRET in tests only. */
  secret?: string;
};

export type PreviewTokenErrorCode = "INVALID" | "EXPIRED" | "MISMATCH";

export class PreviewTokenError extends Error {
  constructor(readonly code: PreviewTokenErrorCode) {
    super(`PREVIEW_TOKEN_${code}`);
    this.name = "PreviewTokenError";
  }
}

export class PreviewTokenConfigurationError extends Error {
  constructor() {
    super("PREVIEW_TOKEN_SECRET_NOT_CONFIGURED");
    this.name = "PreviewTokenConfigurationError";
  }
}

function signingSecret(override?: string) {
  const secret = override ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new PreviewTokenConfigurationError();
  return secret;
}

function unixNow(override?: number) {
  const now = override ?? Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("INVALID_PREVIEW_TOKEN_TIME");
  return now;
}

export function previewInputHash(input: unknown) {
  const parsedInput = createGameSchema.parse(input);
  const normalizedInput = {
    ...parsedInput,
    xUrl: parsedInput.xUrl ?? "",
    websiteUrl: parsedInput.websiteUrl ?? "",
  };
  return sha256(canonicalJson(normalizedInput));
}

function bindingFor(input: unknown, identity: PreviewIdentity): PreviewBinding {
  if (!SHA256_HEX.test(identity.configHash) || !SHA256_HEX.test(identity.manifestHash)) {
    throw new Error("INVALID_PREVIEW_IDENTITY");
  }
  return {
    inputHash: previewInputHash(input),
    configHash: identity.configHash,
    manifestHash: identity.manifestHash,
  };
}

function signatureFor(signedValue: string, secret: string) {
  return createHmac("sha256", secret).update(signedValue).digest();
}

function signatureMatches(encodedSignature: string, signedValue: string, secret: string) {
  if (!BASE64URL.test(encodedSignature)) return false;
  let actual: Buffer;
  try {
    actual = Buffer.from(encodedSignature, "base64url");
  } catch {
    return false;
  }
  const expected = signatureFor(signedValue, secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parsePayload(encodedPayload: string): PreviewTokenPayload {
  if (!encodedPayload || encodedPayload.length > 2_048 || !BASE64URL.test(encodedPayload)) {
    throw new PreviewTokenError("INVALID");
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new PreviewTokenError("INVALID");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PreviewTokenError("INVALID");
  const payload = value as Record<string, unknown>;
  const exactKeys = ["configHash", "exp", "iat", "inputHash", "manifestHash", "v"];
  if (Object.keys(payload).sort().join(",") !== exactKeys.sort().join(",")) throw new PreviewTokenError("INVALID");
  if (
    payload.v !== TOKEN_VERSION ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    typeof payload.inputHash !== "string" ||
    typeof payload.configHash !== "string" ||
    typeof payload.manifestHash !== "string" ||
    !SHA256_HEX.test(payload.inputHash) ||
    !SHA256_HEX.test(payload.configHash) ||
    !SHA256_HEX.test(payload.manifestHash)
  ) {
    throw new PreviewTokenError("INVALID");
  }

  return payload as unknown as PreviewTokenPayload;
}

export function issuePreviewToken(input: unknown, identity: PreviewIdentity, options: TokenOptions = {}) {
  const now = unixNow(options.now);
  const payload: PreviewTokenPayload = {
    v: TOKEN_VERSION,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    ...bindingFor(input, identity),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signedValue = `${TOKEN_PREFIX}.${encodedPayload}`;
  const signature = signatureFor(signedValue, signingSecret(options.secret)).toString("base64url");
  return `${signedValue}.${signature}`;
}

export function verifyPreviewToken(token: unknown, input: unknown, identity: PreviewIdentity, options: TokenOptions = {}) {
  if (typeof token !== "string" || token.length > 4_096) throw new PreviewTokenError("INVALID");
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) throw new PreviewTokenError("INVALID");

  const signedValue = `${parts[0]}.${parts[1]}`;
  if (!signatureMatches(parts[2], signedValue, signingSecret(options.secret))) {
    throw new PreviewTokenError("INVALID");
  }

  const payload = parsePayload(parts[1]);
  const now = unixNow(options.now);
  if (
    payload.exp - payload.iat !== TOKEN_TTL_SECONDS ||
    payload.iat > now + MAX_CLOCK_SKEW_SECONDS ||
    payload.exp <= now
  ) {
    throw new PreviewTokenError(payload.exp <= now ? "EXPIRED" : "INVALID");
  }

  const expected = bindingFor(input, identity);
  if (
    payload.inputHash !== expected.inputHash ||
    payload.configHash !== expected.configHash ||
    payload.manifestHash !== expected.manifestHash
  ) {
    throw new PreviewTokenError("MISMATCH");
  }

  return payload;
}
