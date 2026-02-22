-- Optional note when archiving a snapshot
ALTER TABLE portal_snapshots
  ADD COLUMN IF NOT EXISTS archive_summary TEXT;
COMMENT ON COLUMN portal_snapshots.archive_summary IS 'Optional note set when snapshot was archived';
