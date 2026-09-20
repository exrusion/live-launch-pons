-- Reassert security and reimbursement invariants for databases that may have
-- applied an earlier copy of the Phase 1 migrations.
ALTER TABLE pons_launches DROP CONSTRAINT IF EXISTS pons_launches_rebate_status_check;
ALTER TABLE pons_launches
  ADD CONSTRAINT pons_launches_rebate_status_check
  CHECK (rebate_status IN ('NOT_APPLICABLE','PENDING','SENDING','SENT','FAILED'));

ALTER TABLE pons_launches
  ADD COLUMN IF NOT EXISTS rebate_signed_transaction text,
  ADD COLUMN IF NOT EXISTS rebate_sponsor_address text,
  ADD COLUMN IF NOT EXISTS rebate_nonce numeric(78,0),
  ADD COLUMN IF NOT EXISTS rebate_reserved_wei numeric(78,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rebate_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rebate_error_code text,
  ADD COLUMN IF NOT EXISTS rebate_error_detail text,
  ADD COLUMN IF NOT EXISTS rebate_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS rebate_broadcast_at timestamptz,
  ADD COLUMN IF NOT EXISTS rebate_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS rebate_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS rebate_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS pons_launches_rebate_hash_unique_idx
  ON pons_launches(rebate_tx_hash) WHERE rebate_tx_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pons_launches_rebate_nonce_unique_idx
  ON pons_launches(chain_id, rebate_sponsor_address, rebate_nonce)
  WHERE rebate_sponsor_address IS NOT NULL AND rebate_nonce IS NOT NULL;
CREATE INDEX IF NOT EXISTS pons_launches_rebate_queue_idx
  ON pons_launches(rebate_status, rebate_next_attempt_at, updated_at)
  WHERE rebate_status IN ('PENDING','SENDING');
CREATE UNIQUE INDEX IF NOT EXISTS wallets_one_primary_per_user_idx
  ON wallets(user_id) WHERE is_primary=true;

UPDATE pons_launches
SET submitted_at=COALESCE(submitted_at,updated_at,created_at)
WHERE status IN ('SUBMITTED','CONFIRMING') AND submitted_at IS NULL;
