-- Migration: 004_hitl_tasks
-- Description: Create hitl_tasks table for human-in-the-loop interventions

DO $$ BEGIN
  CREATE TYPE hitl_task_type AS ENUM (
    'CAPTCHA',
    'OTP',
    'DOCUMENT_CLARIFICATION',
    'MANUAL_VERIFICATION',
    'CUSTOM_INPUT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE hitl_task_status AS ENUM (
    'PENDING',
    'ASSIGNED',
    'RESOLVED',
    'EXPIRED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS hitl_tasks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_run_id    UUID NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type          hitl_task_type NOT NULL,
  status        hitl_task_status NOT NULL DEFAULT 'PENDING',
  context       JSONB NOT NULL,
  resolution    JSONB,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_hitl_tasks_job_id ON hitl_tasks (job_id);
CREATE INDEX IF NOT EXISTS idx_hitl_tasks_tenant_id ON hitl_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_hitl_tasks_status ON hitl_tasks (status) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_hitl_tasks_expires ON hitl_tasks (expires_at) WHERE status = 'PENDING';

-- Comments
COMMENT ON TABLE hitl_tasks IS 'Human-in-the-loop intervention requests';
COMMENT ON COLUMN hitl_tasks.context IS 'Context for the human resolver (screenshot URL, prompt, etc.)';
COMMENT ON COLUMN hitl_tasks.resolution IS 'Resolution provided by human operator';
COMMENT ON COLUMN hitl_tasks.expires_at IS 'When this HITL task expires if not resolved';
