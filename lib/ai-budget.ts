import { createHash, randomUUID } from "node:crypto";
import { redis } from "@/lib/redis";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const LEASE_MS = 75_000;

const acquireScript = `
local now = tonumber(ARGV[1])
local expires = tonumber(ARGV[2])
local token = ARGV[3]
local maxConcurrent = tonumber(ARGV[4])
local hourLimit = tonumber(ARGV[5])
local dayLimit = tonumber(ARGV[6])
local userLimit = tonumber(ARGV[7])
local hourTtl = tonumber(ARGV[8])
local dayTtl = tonumber(ARGV[9])

if tonumber(redis.call("GET", KEYS[2]) or "0") >= hourLimit then return {0, 2} end
if tonumber(redis.call("GET", KEYS[3]) or "0") >= dayLimit then return {0, 3} end
if tonumber(redis.call("GET", KEYS[4]) or "0") >= userLimit then return {0, 4} end
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", now)
if redis.call("ZCARD", KEYS[1]) >= maxConcurrent then return {0, 1} end

local hourCount = redis.call("INCR", KEYS[2])
if hourCount == 1 then redis.call("PEXPIRE", KEYS[2], hourTtl) end
local dayCount = redis.call("INCR", KEYS[3])
if dayCount == 1 then redis.call("PEXPIRE", KEYS[3], dayTtl) end
local userCount = redis.call("INCR", KEYS[4])
if userCount == 1 then redis.call("PEXPIRE", KEYS[4], hourTtl) end
redis.call("ZADD", KEYS[1], expires, token)
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[10]))
return {1, 0}
`;

function configuredLimit(name: string, fallback: number, maximum: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : null;
}

export type AiGenerationLease = {
  allowed: boolean;
  reason: "allowed" | "busy" | "hourly" | "daily" | "user" | "unavailable" | "invalid-config";
  release: () => Promise<void>;
};

export function aiBudgetConfigurationStatus() {
  const maxConcurrent = configuredLimit("AI_MAX_CONCURRENCY", 2, 20);
  const hourLimit = configuredLimit("AI_GLOBAL_HOURLY_LIMIT", 16, 500);
  const dayLimit = configuredLimit("AI_GLOBAL_DAILY_LIMIT", 48, 2_000);
  const userLimit = configuredLimit("AI_USER_HOURLY_LIMIT", 4, 50);
  return {
    valid: Boolean(maxConcurrent && hourLimit && dayLimit && userLimit),
    maxConcurrent,
    hourLimit,
    dayLimit,
    userLimit,
  };
}

export async function acquireAiGenerationLease(userId: string): Promise<AiGenerationLease> {
  const client = redis();
  const noRelease = async () => undefined;
  if (!client) return { allowed: false, reason: "unavailable", release: noRelease };
  const { maxConcurrent, hourLimit, dayLimit, userLimit } = aiBudgetConfigurationStatus();
  if (!maxConcurrent || !hourLimit || !dayLimit || !userLimit) {
    return { allowed: false, reason: "invalid-config", release: noRelease };
  }

  const now = Date.now();
  const token = randomUUID();
  const userDigest = createHash("sha256").update(userId).digest("hex");
  const hourBucket = Math.floor(now / HOUR_MS);
  const dayBucket = Math.floor(now / DAY_MS);
  const concurrencyKey = "ai-budget:concurrency";
  try {
    const result = (await client.eval(
      acquireScript,
      4,
      concurrencyKey,
      `ai-budget:global-hour:${hourBucket}`,
      `ai-budget:global-day:${dayBucket}`,
      `ai-budget:user-hour:${hourBucket}:${userDigest}`,
      now,
      now + LEASE_MS,
      token,
      maxConcurrent,
      hourLimit,
      dayLimit,
      userLimit,
      HOUR_MS * 2,
      DAY_MS * 2,
      LEASE_MS * 2,
    )) as [number, number];
    const reason = ["allowed", "busy", "hourly", "daily", "user"][Number(result[1])] as AiGenerationLease["reason"] | undefined;
    if (Number(result[0]) !== 1) return { allowed: false, reason: reason || "unavailable", release: noRelease };
    let released = false;
    return {
      allowed: true,
      reason: "allowed",
      release: async () => {
        if (released) return;
        released = true;
        try {
          await client.zrem(concurrencyKey, token);
        } catch {
          // The short lease expires automatically if Redis becomes unavailable.
        }
      },
    };
  } catch {
    return { allowed: false, reason: "unavailable", release: noRelease };
  }
}
