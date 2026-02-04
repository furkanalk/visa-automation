-- Migration: 003_job_runs
-- Description: Create job_runs table for tracking execution attempts

DO $$ BEGIN
  CREATE TYPE job_run_status AS ENUM (
    'RUNNING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS job_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  worker_id       TEXT NOT NULL,
  attempt_number  INTEGER NOT NULL,
  status          job_run_status NOT NULL DEFAULT 'RUNNING',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  error_code      TEXT,
  error_message   TEXT,
  checkpoint_data JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs (job_id);
CREATE INDEX IF NOT EXISTS idx_job_runs_tenant_id ON job_runs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_job_runs_worker_id ON job_runs (worker_id);
CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs (status) WHERE status = 'RUNNING';

-- Comments
COMMENT ON TABLE job_runs IS 'Individual execution attempts for each job';
COMMENT ON COLUMN job_runs.attempt_number IS 'Which retry attempt this represents (1-based)';
COMMENT ON COLUMN job_runs.checkpoint_data IS 'Saved state for resumption if interrupted';
