import pg from "pg";
import { buildFrozenGameDocument, GAME_RUNTIME_VERSION, gameTemplateVersion } from "../lib/game-runtime";
import { canonicalJson, sha256 } from "../lib/security";
import type { GameConfig } from "../lib/types";

if (process.env.NODE_ENV !== "production") {
  try { process.loadEnvFile(".env.local"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

if (process.env.DATABASE_URL) {
  const { Pool } = pg;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();
  try {
    const versions = await client.query<{ id: string; config: GameConfig }>(
      "SELECT id,config FROM game_versions WHERE document_html IS NULL ORDER BY created_at",
    );
    for (const version of versions.rows) {
      const documentHtml = buildFrozenGameDocument(version.config);
      const configHash = sha256(canonicalJson(version.config));
      const manifestHash = sha256(documentHtml);
      await client.query(
        `UPDATE game_versions
         SET document_html=$2,config_hash=$3,manifest_hash=$4,template_version=$5,runtime_version=$6
         WHERE id=$1 AND document_html IS NULL`,
        [version.id, documentHtml, configHash, manifestHash, gameTemplateVersion(version.config), GAME_RUNTIME_VERSION],
      );
    }
    if (versions.rowCount) console.log(`Backfilled ${versions.rowCount} frozen game document(s).`);
  } finally {
    client.release();
    await pool.end();
  }
} else {
  console.log("DATABASE_URL is not set; skipping frozen-document backfill.");
}
