-- Snapshot diff mode: 'hash' (full HTML hash) or 'selector' (compare selected elements)
ALTER TABLE watcher_config
  ADD COLUMN IF NOT EXISTS diff_mode TEXT NOT NULL DEFAULT 'hash' CHECK (diff_mode IN ('hash', 'selector'));

COMMENT ON COLUMN watcher_config.diff_mode IS 'hash: compare full HTML hash; selector: compare content of configured portal selectors';
