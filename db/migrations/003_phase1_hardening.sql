-- Additive upgrade path for databases that applied 001 before these Phase 1
-- invariants were introduced. Every statement is safe to rerun.
ALTER TABLE pons_launches ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE run_sessions ADD COLUMN IF NOT EXISTS started_at timestamptz;

ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_sha256_kind_key;
CREATE INDEX IF NOT EXISTS assets_hash_idx ON assets(sha256, kind);

CREATE UNIQUE INDEX IF NOT EXISTS pons_launches_one_active_per_game_idx
  ON pons_launches(game_id)
  WHERE status IN ('QUOTING','AWAITING_SIGNATURE','SUBMITTED','CONFIRMING','CONFIRMED');

CREATE UNIQUE INDEX IF NOT EXISTS wallets_one_primary_per_user_idx
  ON wallets(user_id)
  WHERE is_primary=true;
