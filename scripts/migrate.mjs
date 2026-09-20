import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not set; skipping migrations.");
  process.exit(0);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(746562194301)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text");
  const directory = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const sql = await readFile(path.join(directory, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const found = await client.query("SELECT checksum FROM schema_migrations WHERE name = $1", [name]);
    if (found.rowCount) {
      if (found.rows[0].checksum && found.rows[0].checksum !== checksum) throw new Error(`Migration checksum mismatch: ${name}`);
      if (!found.rows[0].checksum) await client.query("UPDATE schema_migrations SET checksum=$2 WHERE name=$1", [name, checksum]);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name,checksum) VALUES ($1,$2)", [name, checksum]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(746562194301)").catch(() => undefined);
  client.release();
  await pool.end();
}
