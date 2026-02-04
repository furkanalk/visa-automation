-- Migration: 002_jobs
-- Description: Create jobs table for visa application jobs

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM (
    'QUEUED',
    'LOGIN_PROCESS',
    'LOGGED_IN',
    'FORM_FILLING',
    'PROCESSING',
    'SLOT_SEARCHING',
    'SLOT_FOUND',
    'PAYMENT',
    'WAITING_HITL',
    'PAUSED',
    'COMPLETED',
    'FAILED_RETRYABLE',
    'FAILED_TERMINAL',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE visa_type AS ENUM (
    'SCHENGEN',
    'UK',
    'US',
    'CANADA',
    'AUSTRALIA',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_ref    TEXT,
  visa_type       visa_type NOT NULL,
  status          job_status NOT NULL DEFAULT 'QUEUED',
  priority        INTEGER NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  applicant_data  JSONB NOT NULL,
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  locked_by       TEXT,
  locked_until    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_id ON jobs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant_status ON jobs (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs (priority DESC, created_at ASC) WHERE status = 'QUEUED';
CREATE INDEX IF NOT EXISTS idx_jobs_locked ON jobs (locked_by, locked_until) WHERE locked_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_external_ref ON jobs (tenant_id, external_ref) WHERE external_ref IS NOT NULL;

-- Comments
COMMENT ON TABLE jobs IS 'Visa application jobs submitted for processing';
COMMENT ON COLUMN jobs.priority IS 'Job priority 0-100, higher = more priority';
COMMENT ON COLUMN jobs.applicant_data IS 'Applicant information as JSON';
COMMENT ON COLUMN jobs.locked_by IS 'Worker ID holding the lock';
COMMENT ON COLUMN jobs.locked_until IS 'Lock expiration time';
