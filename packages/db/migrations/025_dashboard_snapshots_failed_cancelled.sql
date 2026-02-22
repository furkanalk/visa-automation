-- Add failed_jobs and cancelled_jobs to dashboard_snapshots for job outcome chart
ALTER TABLE dashboard_snapshots
  ADD COLUMN IF NOT EXISTS failed_jobs INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_jobs INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN dashboard_snapshots.failed_jobs IS 'Count of FAILED_TERMINAL + FAILED_RETRYABLE at snapshot time';
COMMENT ON COLUMN dashboard_snapshots.cancelled_jobs IS 'Count of CANCELLED at snapshot time';
