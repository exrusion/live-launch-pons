import pg from "pg";

const { Pool } = pg;

type GlobalPool = typeof globalThis & { __ponsPool?: pg.Pool };

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  const scope = globalThis as GlobalPool;
  if (!scope.__ponsPool) {
    scope.__ponsPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 12,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    });
    scope.__ponsPool.on("error", (error) => console.error("database_pool_error", { message: error.message }));
  }
  return scope.__ponsPool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
  return db().query<T>(text, values);
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseReady() {
  if (!hasDatabase()) return false;
  try {
    await query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
