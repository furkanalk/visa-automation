-- Watcher: configurable retention (days) and HTML diff check interval
ALTER TABLE watcher_config
  ADD COLUMN IF NOT EXISTS run_retention_days INT NOT NULL DEFAULT 7 CHECK (run_retention_days > 0 AND run_retention_days <= 365),
  ADD COLUMN IF NOT EXISTS snapshot_retention_days INT NOT NULL DEFAULT 7 CHECK (snapshot_retention_days > 0 AND snapshot_retention_days <= 365),
  ADD COLUMN IF NOT EXISTS html_diff_interval TEXT NOT NULL DEFAULT '1d' CHECK (html_diff_interval IN ('every_run', '1h', '3h', '12h', '1d', '1w')),
  ADD COLUMN IF NOT EXISTS last_html_diff_at TIMESTAMPTZ;

COMMENT ON COLUMN watcher_config.run_retention_days IS 'Days to keep watcher run history; older runs are pruned';
COMMENT ON COLUMN watcher_config.snapshot_retention_days IS 'Days to keep non-archived snapshots; archived snapshots are kept indefinitely';
COMMENT ON COLUMN watcher_config.html_diff_interval IS 'How often to run HTML snapshot/diff: every_run, 1h, 3h, 12h, 1d, 1w';
COMMENT ON COLUMN watcher_config.last_html_diff_at IS 'Last time HTML diff (snapshot capture) ran for this tenant';
