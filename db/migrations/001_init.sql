CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL DEFAULT 'CREATOR' CHECK (role IN ('CREATOR','ADMIN')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  display_name text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS x_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_user_id text NOT NULL UNIQUE,
  username text NOT NULL,
  profile_image_url text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chain_id integer NOT NULL DEFAULT 4663,
  address text NOT NULL,
  address_normalized text NOT NULL,
  verified_at timestamptz NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, address_normalized)
);
CREATE INDEX IF NOT EXISTS wallets_user_idx ON wallets(user_id);

CREATE TABLE IF NOT EXISTS wallet_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_normalized text NOT NULL,
  nonce_hash text NOT NULL UNIQUE,
  domain text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_nonces_lookup_idx ON wallet_nonces(user_id, address_normalized, expires_at);

CREATE TABLE IF NOT EXISTS free_launch_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x_account_id uuid NOT NULL REFERENCES x_accounts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','RESERVED','USED','REJECTED')),
  reserved_wallet_address text,
  reservation_expires_at timestamptz,
  used_launch_id uuid,
  rejection_code text,
  rejection_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (x_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS free_launch_wallet_once_idx
  ON free_launch_credits(reserved_wallet_address)
  WHERE reserved_wallet_address IS NOT NULL AND status IN ('RESERVED','USED');
CREATE INDEX IF NOT EXISTS free_launch_user_idx ON free_launch_credits(user_id, status);

CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  ticker text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('RUNNER','FLAPPY','SHOOTER')),
  visual_style text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('EASY','NORMAL','HARD')),
  prompt text NOT NULL,
  website_url text,
  x_url text,
  developer_buy_wei numeric(78,0) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','GENERATING','PREVIEW_READY','LAUNCHING','LIVE','FAILED','DEMO')),
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS games_owner_idx ON games(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS games_explore_idx ON games(status, created_at DESC);

CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  game_id uuid REFERENCES games(id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_backend text NOT NULL DEFAULT 'POSTGRES',
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  width integer,
  height integer,
  data bytea,
  scan_status text NOT NULL DEFAULT 'APPROVED' CHECK (scan_status IN ('PENDING','APPROVED','REJECTED')),
  moderation_status text NOT NULL DEFAULT 'APPROVED' CHECK (moderation_status IN ('PENDING','APPROVED','REJECTED')),
  immutable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_game_idx ON assets(game_id);
CREATE INDEX IF NOT EXISTS assets_hash_idx ON assets(sha256, kind);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  game_id uuid REFERENCES games(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'GAME_CONFIG',
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','GENERATING','VALIDATING','SUCCEEDED','FAILED')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  input_hash text NOT NULL,
  output_hash text,
  provider text,
  model text,
  attempts integer NOT NULL DEFAULT 0,
  error_code text,
  error_detail text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generation_jobs_queue_idx ON generation_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS game_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 1,
  prompt text NOT NULL,
  config jsonb,
  generation_job_id uuid REFERENCES generation_jobs(id) ON DELETE SET NULL,
  moderation_status text NOT NULL DEFAULT 'APPROVED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, revision)
);

CREATE TABLE IF NOT EXISTS game_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  deterministic_id text NOT NULL UNIQUE,
  template_version text NOT NULL,
  runtime_version text NOT NULL,
  config jsonb NOT NULL,
  config_hash text NOT NULL,
  manifest_hash text NOT NULL,
  prompt text NOT NULL,
  release_notes text,
  status text NOT NULL DEFAULT 'PREVIEW' CHECK (status IN ('PREVIEW','PUBLISHED','ARCHIVED')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (game_id, version_number)
);
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_current_version_fk;
ALTER TABLE games ADD CONSTRAINT games_current_version_fk FOREIGN KEY (current_version_id) REFERENCES game_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS pons_launches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_version_id uuid NOT NULL REFERENCES game_versions(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  wallet_address text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  chain_id integer NOT NULL DEFAULT 4663,
  factory_address text NOT NULL,
  pair_token text NOT NULL,
  launch_config_id numeric(78,0) NOT NULL,
  launch_fee_wei numeric(78,0) NOT NULL,
  expected_economics text NOT NULL,
  salt text NOT NULL,
  token_params jsonb NOT NULL,
  transaction_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'AWAITING_SIGNATURE' CHECK (status IN ('QUOTING','AWAITING_SIGNATURE','SUBMITTED','CONFIRMING','CONFIRMED','FAILED','EXPIRED')),
  transaction_hash text UNIQUE,
  submitted_at timestamptz,
  receipt_block numeric(78,0),
  token_address text,
  curve_address text,
  free_credit_id uuid REFERENCES free_launch_credits(id) ON DELETE SET NULL,
  rebate_status text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (rebate_status IN ('NOT_APPLICABLE','PENDING','SENT','FAILED')),
  rebate_tx_hash text,
  error_code text,
  error_detail text,
  retry_parent_id uuid REFERENCES pons_launches(id) ON DELETE SET NULL,
  quote_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE free_launch_credits DROP CONSTRAINT IF EXISTS free_launch_used_launch_fk;
ALTER TABLE free_launch_credits ADD CONSTRAINT free_launch_used_launch_fk FOREIGN KEY (used_launch_id) REFERENCES pons_launches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pons_launches_status_idx ON pons_launches(status, updated_at);
CREATE INDEX IF NOT EXISTS pons_launches_user_idx ON pons_launches(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS pons_launches_one_active_per_game_idx
  ON pons_launches(game_id)
  WHERE status IN ('QUOTING','AWAITING_SIGNATURE','SUBMITTED','CONFIRMING','CONFIRMED');

CREATE TABLE IF NOT EXISTS tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL UNIQUE REFERENCES games(id) ON DELETE CASCADE,
  launch_id uuid NOT NULL UNIQUE REFERENCES pons_launches(id) ON DELETE RESTRICT,
  chain_id integer NOT NULL DEFAULT 4663,
  address text NOT NULL,
  address_normalized text NOT NULL,
  curve_address text NOT NULL,
  decimals integer NOT NULL DEFAULT 18,
  launch_transaction_hash text NOT NULL,
  confirmed_block numeric(78,0) NOT NULL,
  pons_url text NOT NULL,
  explorer_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, address_normalized)
);

CREATE TABLE IF NOT EXISTS run_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_version_id uuid NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  wallet_address text,
  x_account_id uuid REFERENCES x_accounts(id) ON DELETE SET NULL,
  server_seed_hash text NOT NULL,
  run_token_hash text NOT NULL UNIQUE,
  started_at timestamptz,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_sessions_game_idx ON run_sessions(game_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_session_id uuid NOT NULL UNIQUE REFERENCES run_sessions(id) ON DELETE CASCADE,
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_version_id uuid NOT NULL REFERENCES game_versions(id) ON DELETE CASCADE,
  wallet_address text,
  x_account_id uuid REFERENCES x_accounts(id) ON DELETE SET NULL,
  metric text NOT NULL DEFAULT 'SCORE',
  score bigint NOT NULL CHECK (score >= 0),
  validation_status text NOT NULL DEFAULT 'PENDING' CHECK (validation_status IN ('PENDING','VALID','REJECTED','REVIEW')),
  validation_reason text,
  replay_hash text NOT NULL,
  duration_ms integer NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz
);
CREATE INDEX IF NOT EXISTS scores_leaderboard_idx ON scores(game_id, validation_status, score DESC, submitted_at ASC);

CREATE TABLE IF NOT EXISTS score_replays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score_id uuid NOT NULL UNIQUE REFERENCES scores(id) ON DELETE CASCADE,
  event_log jsonb NOT NULL,
  storage_key text,
  seed_hash text NOT NULL,
  duration_ms integer NOT NULL,
  replay_hash text NOT NULL,
  validator_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  proposer_wallet text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  snapshot_block numeric(78,0),
  starts_at timestamptz,
  ends_at timestamptz,
  status text NOT NULL DEFAULT 'DISABLED',
  advisory boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  block_number numeric(78,0) NOT NULL,
  block_hash text,
  balances jsonb NOT NULL DEFAULT '{}'::jsonb,
  excluded_addresses jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, block_number)
);

CREATE TABLE IF NOT EXISTS votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  choice text NOT NULL,
  weight numeric(78,0) NOT NULL,
  snapshot_id uuid REFERENCES balance_snapshots(id) ON DELETE SET NULL,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, wallet_address)
);

CREATE TABLE IF NOT EXISTS tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_version_id uuid NOT NULL REFERENCES game_versions(id) ON DELETE RESTRICT,
  mode text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  rules jsonb NOT NULL,
  prize_asset text,
  confirmed_prize_amount numeric(78,0),
  status text NOT NULL DEFAULT 'DISABLED',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  score_id uuid NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  final_rank integer,
  reward_amount numeric(78,0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, score_id)
);

CREATE TABLE IF NOT EXISTS reward_vaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  chain_id integer NOT NULL DEFAULT 4663,
  address text,
  asset_address text,
  status text NOT NULL DEFAULT 'DISABLED',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reward_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_vault_id uuid NOT NULL REFERENCES reward_vaults(id) ON DELETE CASCADE,
  depositor text NOT NULL,
  amount numeric(78,0) NOT NULL,
  transaction_hash text NOT NULL UNIQUE,
  confirmed_block numeric(78,0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reward_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  amount numeric(78,0) NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  transaction_hash text UNIQUE,
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fee_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  creator_bps integer NOT NULL,
  tournament_bps integer NOT NULL,
  development_bps integer NOT NULL,
  platform_bps integer NOT NULL,
  source text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (creator_bps + tournament_bps + development_bps + platform_bps = 10000)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer,
  response_body jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, route, key)
);

CREATE TABLE IF NOT EXISTS security_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  wallet_address text,
  ip_hash text,
  risk_type text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'OPEN',
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS security_flags_open_idx ON security_flags(status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  request_id text,
  ip_hash text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_user_id, created_at DESC);
