import { createHash, randomBytes } from "node:crypto";

const unsafePromptPatterns = [
  /<script/i,
  /javascript:/i,
  /data:text\/html/i,
  /document\.(cookie|location)/i,
  /window\.(ethereum|localStorage|sessionStorage)/i,
  /seed phrase/i,
  /private key/i,
];

export function moderateText(value: string) {
  const text = value.normalize("NFKC").trim();
  if (!text) return { ok: false as const, code: "EMPTY_TEXT" };
  if (unsafePromptPatterns.some((pattern) => pattern.test(text))) {
    return { ok: false as const, code: "UNSAFE_CONTENT" };
  }
  return { ok: true as const, text };
}

export function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

export function makeNonce(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

export function hashIp(value: string | null | undefined) {
  return sha256(`ip:${value || "unknown"}:${process.env.NEXTAUTH_SECRET || "local"}`);
}

export function requestIp(headers: Headers) {
  return headers.get("x-real-ip") || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected && origin !== process.env.APP_URL) throw new Error("INVALID_ORIGIN");
}

export function safeError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 300);
  return "Unexpected error";
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 54);
}
