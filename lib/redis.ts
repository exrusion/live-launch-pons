import IORedis, { type RedisOptions } from "ioredis";

type RedisScope = typeof globalThis & {
  __ponsRedis?: IORedis;
};

const baseOptions: RedisOptions = {
  connectTimeout: 2_000,
  enableReadyCheck: true,
  keepAlive: 10_000,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => Math.min(attempt * 250, 2_000),
};

export const WORKER_HEARTBEAT_KEY = "pons-game-studio:worker:heartbeat";
const WORKER_HEARTBEAT_TTL_SECONDS = 45;

export function hasRedis() {
  return Boolean(process.env.REDIS_URL);
}

function observe(client: IORedis, purpose: string) {
  client.on("error", (error) => {
    console.warn("redis_connection_error", { purpose, message: error.message });
  });
  return client;
}

/** Shared, fail-fast client for request-path commands and queue producers. */
export function redis() {
  if (!process.env.REDIS_URL) return null;
  const scope = globalThis as RedisScope;
  if (!scope.__ponsRedis) {
    scope.__ponsRedis = observe(new IORedis(process.env.REDIS_URL, baseOptions), "application");
  }
  return scope.__ponsRedis;
}

/** BullMQ workers require an unbounded per-command retry policy. */
export function createWorkerRedis() {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is not configured");
  return observe(
    new IORedis(process.env.REDIS_URL, {
      ...baseOptions,
      maxRetriesPerRequest: null,
    }),
    "worker",
  );
}

export async function redisReady() {
  const client = redis();
  if (!client) return false;
  try {
    return (await client.ping()) === "PONG";
  } catch {
    return false;
  }
}

export async function recordWorkerHeartbeat(workerId: string) {
  const client = redis();
  if (!client) return false;
  try {
    await client.set(
      WORKER_HEARTBEAT_KEY,
      JSON.stringify({ workerId, at: Date.now() }),
      "EX",
      WORKER_HEARTBEAT_TTL_SECONDS,
    );
    return true;
  } catch {
    return false;
  }
}

export async function workerHeartbeatReady() {
  const client = redis();
  if (!client) return null;
  try {
    const raw = await client.get(WORKER_HEARTBEAT_KEY);
    if (!raw) return false;
    const heartbeat = JSON.parse(raw) as { at?: unknown };
    return typeof heartbeat.at === "number" && Date.now() - heartbeat.at < WORKER_HEARTBEAT_TTL_SECONDS * 1_000;
  } catch {
    return false;
  }
}
