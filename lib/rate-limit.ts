import { createHash } from "node:crypto";
import { redis } from "@/lib/redis";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const incrementWindow = `
local count = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if count == 1 or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

function memoryRateLimit(digest: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  const existing = buckets.get(digest);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSeconds * 1_000;
    buckets.set(digest, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt };
  }
  existing.count += 1;
  if (buckets.size > 5_000) {
    for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
  }
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
  };
}

export async function checkRateLimit(key: string, limit: number, windowSeconds: number) {
  const digest = createHash("sha256").update(key).digest("hex");
  const client = redis();
  if (client) {
    try {
      const windowMs = windowSeconds * 1_000;
      const result = (await client.eval(
        incrementWindow,
        1,
        `rate-limit:${windowSeconds}:${digest}`,
        windowMs,
      )) as [number, number];
      const count = Number(result[0]);
      const ttl = Math.max(0, Number(result[1]));
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetAt: Date.now() + ttl,
      };
    } catch (error) {
      console.warn("redis_rate_limit_fallback", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return memoryRateLimit(digest, limit, windowSeconds);
}
