CREATE TABLE IF NOT EXISTS service_heartbeats (
  service_name text PRIMARY KEY,
  instance_id text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS service_heartbeats_seen_idx
  ON service_heartbeats(last_seen_at DESC);
