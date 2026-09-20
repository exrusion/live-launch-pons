import pg from "pg";
import { freezeGameVersion, generateGameConfig } from "../lib/game-generator.ts";

if (process.env.NODE_ENV !== "production") {
  try { process.loadEnvFile(".env.local"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not set; skipping seed.");
  process.exit(0);
}

const input = {
  name: "Neon Burrow",
  ticker: "BURROW",
  description: "Race through a collapsing cyber lab and collect neurons.",
  prompt: "A cyber mouse runs through a collapsing laboratory, collects neurons and avoids security drones.",
  category: "RUNNER",
  visualStyle: "Neon arcade",
  difficulty: "NORMAL",
  developerBuyEth: "0",
  xUrl: "",
  websiteUrl: "",
};
const config = generateGameConfig(input);
const frozen = freezeGameVersion(config);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const gameResult = await client.query(
    `INSERT INTO games (slug,name,ticker,description,category,visual_style,difficulty,prompt,status)
     VALUES ('neon-burrow-demo','Neon Burrow','BURROW','Race through a collapsing cyber lab and collect neurons.','RUNNER','Neon arcade','NORMAL','A cyber mouse runs through a collapsing laboratory, collects neurons and avoids security drones.','DEMO')
     ON CONFLICT (slug) DO UPDATE SET updated_at = now()
     RETURNING id`,
  );
  const gameId = gameResult.rows[0].id;
  const versionResult = await client.query(
    `INSERT INTO game_versions (game_id,version_number,deterministic_id,template_version,runtime_version,config,config_hash,manifest_hash,document_html,prompt,release_notes,status,published_at)
     SELECT $1,COALESCE(MAX(version_number),0)+1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'Frozen demo build.','PUBLISHED',now()
     FROM game_versions WHERE game_id=$1
     ON CONFLICT (deterministic_id) DO UPDATE SET
       template_version=EXCLUDED.template_version,runtime_version=EXCLUDED.runtime_version,config=EXCLUDED.config,
       config_hash=EXCLUDED.config_hash,manifest_hash=EXCLUDED.manifest_hash,document_html=EXCLUDED.document_html
     RETURNING id`,
    [gameId, frozen.deterministicId, frozen.templateVersion, frozen.runtimeVersion, frozen.configJson, frozen.configHash, frozen.manifestHash, frozen.documentHtml, input.prompt],
  );
  await client.query("UPDATE games SET current_version_id=$1 WHERE id=$2", [versionResult.rows[0].id, gameId]);
  await client.query("COMMIT");
  console.log("Seeded Neon Burrow demo.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
