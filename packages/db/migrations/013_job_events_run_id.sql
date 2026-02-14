-- Migration: 013_job_events_run_id
-- Description: Add job_run_id to job_events for run-scoped audit and idempotency

ALTER TABLE job_events
  ADD COLUMN IF NOT EXISTS job_run_id UUID NULL REFERENCES job_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_events_job_run_id ON job_events (job_run_id) WHERE job_run_id IS NOT NULL;

COMMENT ON COLUMN job_events.job_run_id IS 'Links event to a specific job run (execution attempt) for audit and idempotency';
