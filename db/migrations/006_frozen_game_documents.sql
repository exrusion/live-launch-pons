-- New versions store the exact HTML artifact that was approved in preview.
-- Nullable keeps pre-freeze versions and seeded/demo rows backward compatible.
ALTER TABLE game_versions
  ADD COLUMN IF NOT EXISTS document_html text;

COMMENT ON COLUMN game_versions.document_html IS
  'Immutable canonical HTML returned by preview and served byte-for-byte by embed routes.';
