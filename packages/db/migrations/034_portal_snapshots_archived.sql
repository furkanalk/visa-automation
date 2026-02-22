-- Archive support: archived snapshots are kept beyond 7-day retention
ALTER TABLE portal_snapshots
  ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN portal_snapshots.archived IS 'When true, snapshot is kept beyond retention; not auto-deleted';
COMMENT ON COLUMN portal_snapshots.archived_at IS 'When snapshot was archived';

CREATE INDEX IF NOT EXISTS idx_portal_snapshots_archived ON portal_snapshots(tenant_id, archived) WHERE archived = true;
