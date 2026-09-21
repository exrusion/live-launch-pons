-- Free-credit launches are submitted by the owner-funded platform wallet.
-- The raw transaction is persisted before broadcast so retries can only
-- rebroadcast the exact same transaction.
ALTER TABLE pons_launches
  ADD COLUMN IF NOT EXISTS sponsored_launch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sponsored_signed_transaction text,
  ADD COLUMN IF NOT EXISTS sponsored_nonce numeric(78,0),
  ADD COLUMN IF NOT EXISTS sponsored_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsored_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sponsored_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sponsored_broadcast_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS pons_launches_sponsored_nonce_unique_idx
  ON pons_launches(chain_id, wallet_address, sponsored_nonce)
  WHERE sponsored_launch=true AND sponsored_nonce IS NOT NULL;

CREATE INDEX IF NOT EXISTS pons_launches_sponsored_queue_idx
  ON pons_launches(sponsored_launch, status, sponsored_next_attempt_at, updated_at)
  WHERE sponsored_launch=true AND status='AWAITING_SIGNATURE';

-- Any unapproved free-credit quote from the old reimbursement flow must not
-- keep prompting the creator wallet after this upgrade. Submitted or mined
-- transactions are deliberately untouched.
UPDATE free_launch_credits f
SET status='AVAILABLE',reserved_wallet_address=NULL,reservation_expires_at=NULL,updated_at=now()
WHERE f.status='RESERVED'
  AND EXISTS (
    SELECT 1 FROM pons_launches p
    WHERE p.free_credit_id=f.id
      AND p.status='AWAITING_SIGNATURE'
      AND p.transaction_hash IS NULL
      AND p.sponsored_launch=false
  );

UPDATE pons_launches
SET status='EXPIRED',rebate_reserved_wei=0,
    error_code='SPONSORED_FLOW_UPGRADE',
    error_detail='The old creator-paid quote was cancelled. Start the free launch again so the platform wallet pays.',
    updated_at=now()
WHERE status='AWAITING_SIGNATURE'
  AND transaction_hash IS NULL
  AND free_credit_id IS NOT NULL
  AND sponsored_launch=false;

UPDATE games g
SET status='DRAFT',updated_at=now()
WHERE g.status='LAUNCHING'
  AND NOT EXISTS (SELECT 1 FROM tokens t WHERE t.game_id=g.id)
  AND NOT EXISTS (
    SELECT 1 FROM pons_launches p
    WHERE p.game_id=g.id AND p.status IN ('QUOTING','AWAITING_SIGNATURE','SUBMITTED','CONFIRMING','CONFIRMED')
  );
