import { createHash } from "node:crypto";
import pg from "pg";

if (process.env.NODE_ENV !== "production") {
  try { process.loadEnvFile(".env.local"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not set; skipping seed.");
  process.exit(0);
}

const config = {
  category: "RUNNER",
  title: "Neon Burrow",
  instructions: "Tap, click, or press Space to jump. Collect neurons and dodge the lab drones.",
  story: "A cyber mouse races through a collapsing neural laboratory.",
  palette: { background: "#07110d", primary: "#74ff9a", accent: "#ffda57", danger: "#ff5577", text: "#f4fff7" },
  character: { shape: "mouse", label: "Milo" },
  obstacle: { shape: "drone", label: "Security drone" },
  collectible: { shape: "neuron", label: "Neuron" },
  difficulty: "NORMAL",
  speed: 1,
  soundStyle: "arcade",
  seed: 7331,
};
const canonical = JSON.stringify(config);
const hash = createHash("sha256").update(canonical).digest("hex");
const deterministicId = `v1-${hash.slice(0, 24)}`;

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
    `INSERT INTO game_versions (game_id,version_number,deterministic_id,template_version,runtime_version,config,config_hash,manifest_hash,prompt,release_notes,status,published_at)
     VALUES ($1,1,$2,'runner-v1','runtime-v1',$3::jsonb,$4,$4,'A cyber mouse runs through a collapsing laboratory, collects neurons and avoids security drones.','Original demo build.','PUBLISHED',now())
     ON CONFLICT (deterministic_id) DO UPDATE SET deterministic_id = EXCLUDED.deterministic_id
     RETURNING id`,
    [gameId, deterministicId, canonical, hash],
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
