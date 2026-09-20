import { hasDatabase, query } from "@/lib/db";
import type { GameConfig } from "@/lib/types";

export const demoConfig: GameConfig = {
  category: "RUNNER",
  title: "Neon Burrow",
  instructions: "Tap, click, or press Space to jump. Collect every neuron.",
  story: "Cyber mouse enters the neural lab. Avoid security drones and keep the run alive.",
  palette: { background: "#07110d", primary: "#74ff9a", accent: "#ffda57", danger: "#ff5577", text: "#f4fff7" },
  character: { shape: "cyber mouse", label: "cyber mouse" },
  obstacle: { shape: "security drone", label: "security drone" },
  collectible: { shape: "neuron", label: "neuron" },
  difficulty: "NORMAL",
  speed: 1,
  soundStyle: "arcade",
  seed: 7331,
};

export type ExploreGame = {
  id: string;
  slug: string;
  name: string;
  ticker: string;
  description: string;
  category: string;
  status: string;
  versionId: string;
  tokenAddress: string | null;
  imageId: string | null;
  players: number;
};

export async function exploreGames(): Promise<ExploreGame[]> {
  if (!hasDatabase()) return [{ id: "demo", slug: "neon-burrow-demo", name: "Neon Burrow", ticker: "BURROW", description: "Race through a collapsing cyber lab and collect neurons.", category: "RUNNER", status: "DEMO", versionId: "demo", tokenAddress: null, imageId: null, players: 0 }];
  const result = await query<ExploreGame>(
    `SELECT g.id,g.slug,g.name,g.ticker,g.description,g.category,g.status,
       COALESCE(g.current_version_id::text,'') AS "versionId",t.address AS "tokenAddress",
       (SELECT a.id::text FROM assets a WHERE a.game_id=g.id AND a.kind='TOKEN_IMAGE' ORDER BY a.created_at DESC LIMIT 1) AS "imageId",
       (SELECT count(DISTINCT COALESCE(s.wallet_address,s.x_account_id::text,s.id::text))::int FROM scores s WHERE s.game_id=g.id AND s.validation_status='VALID') AS players
     FROM games g LEFT JOIN tokens t ON t.game_id=g.id
     WHERE g.status IN ('LIVE','DEMO') ORDER BY CASE WHEN g.status='LIVE' THEN 0 ELSE 1 END,g.created_at DESC LIMIT 24`,
  );
  return result.rows;
}

export async function gameByPublicId(publicId: string, viewerUserId?: string) {
  if (!hasDatabase() && (publicId === "neon-burrow-demo" || publicId === "demo")) {
    return { id: "demo", slug: "neon-burrow-demo", name: "Neon Burrow", ticker: "BURROW", description: "Race through a collapsing cyber lab and collect neurons.", category: "RUNNER", status: "DEMO", prompt: "A cyber mouse runs through a collapsing laboratory, collects neurons and avoids security drones.", visual_style: "Neon arcade", difficulty: "NORMAL", version_id: "demo", deterministic_id: "demo-v1", version_number: 1, config: demoConfig, token_address: null, curve_address: null, launch_transaction_hash: null, pons_url: null, explorer_url: null, creator_username: "pons studio", creator_image: null, image_id: null };
  }
  if (!hasDatabase()) return null;
  const result = await query(
    `SELECT g.*,v.id AS version_id,v.deterministic_id,v.version_number,v.config,t.address AS token_address,t.curve_address,t.launch_transaction_hash,t.pons_url,t.explorer_url,
       x.username AS creator_username,x.profile_image_url AS creator_image,
       (SELECT a.id FROM assets a WHERE a.game_id=g.id AND a.kind='TOKEN_IMAGE' ORDER BY a.created_at DESC LIMIT 1) AS image_id
     FROM games g JOIN game_versions v ON v.id=g.current_version_id
     LEFT JOIN tokens t ON t.game_id=g.id LEFT JOIN x_accounts x ON x.user_id=g.owner_user_id
     WHERE (lower(COALESCE(t.address,''))=lower($1) OR g.slug=$1)
       AND (g.status IN ('LIVE','DEMO') OR g.owner_user_id=$2::uuid)
     LIMIT 1`,
    [publicId, viewerUserId || null],
  );
  return result.rows[0] || null;
}

export async function gameVersion(versionId: string, viewerUserId?: string) {
  if (versionId === "demo" && !hasDatabase()) return { id: "demo", config: demoConfig, game_id: "demo" };
  if (!hasDatabase()) return null;
  const result = await query<{ id: string; game_id: string; config: GameConfig }>(
    `SELECT v.id,v.game_id,v.config FROM game_versions v JOIN games g ON g.id=v.game_id
     WHERE (v.id::text=$1 OR v.deterministic_id=$1)
       AND ((v.status='PUBLISHED' AND g.status IN ('LIVE','DEMO')) OR g.owner_user_id=$2::uuid)
     LIMIT 1`,
    [versionId, viewerUserId || null],
  );
  return result.rows[0] || null;
}

export async function creatorGames(userId: string) {
  if (!hasDatabase()) return [];
  const result = await query(
    `SELECT g.*,v.deterministic_id,t.address AS token_address,p.status AS launch_status,p.error_detail,
      (SELECT a.id FROM assets a WHERE a.game_id=g.id AND a.kind='TOKEN_IMAGE' ORDER BY a.created_at DESC LIMIT 1) AS image_id
     FROM games g LEFT JOIN game_versions v ON v.id=g.current_version_id LEFT JOIN tokens t ON t.game_id=g.id
     LEFT JOIN LATERAL (SELECT status,error_detail FROM pons_launches WHERE game_id=g.id ORDER BY created_at DESC LIMIT 1) p ON true
     WHERE g.owner_user_id=$1 ORDER BY g.updated_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function freeLaunchStatus(userId: string) {
  if (!hasDatabase()) return null;
  const result = await query(
    `SELECT f.*,x.username,w.address AS primary_wallet FROM free_launch_credits f
     JOIN x_accounts x ON x.id=f.x_account_id LEFT JOIN wallets w ON w.user_id=f.user_id AND w.is_primary=true
     WHERE f.user_id=$1 LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}
