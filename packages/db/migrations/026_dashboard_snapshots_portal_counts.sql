-- Add portal up/down counts to dashboard_snapshots for Portals status chart
ALTER TABLE dashboard_snapshots
  ADD COLUMN IF NOT EXISTS portal_up_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS portal_down_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN dashboard_snapshots.portal_up_count IS 'Number of portals reported up at snapshot time (across all tenants)';
COMMENT ON COLUMN dashboard_snapshots.portal_down_count IS 'Number of portals reported down at snapshot time (across all tenants)';
