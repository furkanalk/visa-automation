-- Migration: 007_job_status_summary
-- Description: Create portal-optimized job status summary table

CREATE TABLE IF NOT EXISTS job_status_summary (
  job_id              UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  current_state       TEXT NOT NULL,
  status_text         TEXT NOT NULL,
  priority            INTEGER NOT NULL,
  applicant_name      TEXT,
  last_transition_at  TIMESTAMPTZ NOT NULL,
  last_error_code     TEXT,
  last_error_message  TEXT,
  hitl_pending        BOOLEAN NOT NULL DEFAULT false,
  hitl_expires_at     TIMESTAMPTZ,
  evidence_pack_id    UUID REFERENCES evidence_packs(id),
  confirmation_number TEXT,
  created_at          TIMESTAMPTZ NOT NULL,
  completed_at        TIMESTAMPTZ
);

-- Indexes for portal queries
CREATE INDEX IF NOT EXISTS idx_job_status_summary_tenant_created 
  ON job_status_summary (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_status_summary_tenant_state 
  ON job_status_summary (tenant_id, current_state);

CREATE INDEX IF NOT EXISTS idx_job_status_summary_hitl 
  ON job_status_summary (tenant_id, hitl_expires_at) 
  WHERE hitl_pending = true;

-- Function to update job_status_summary on state transition
CREATE OR REPLACE FUNCTION update_job_status_summary()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO job_status_summary (
    job_id,
    tenant_id,
    current_state,
    status_text,
    priority,
    applicant_name,
    last_transition_at,
    created_at
  )
  VALUES (
    NEW.id,
    NEW.tenant_id,
    NEW.status::text,
    CASE NEW.status
      WHEN 'QUEUED' THEN 'Job queued for processing'
      WHEN 'LOGIN_PROCESS' THEN 'Logging into portal'
      WHEN 'LOGGED_IN' THEN 'Successfully logged in'
      WHEN 'FORM_FILLING' THEN 'Filling application form'
      WHEN 'PROCESSING' THEN 'Processing application'
      WHEN 'WAITING_HITL' THEN 'Waiting for human verification'
      WHEN 'COMPLETED' THEN 'Application completed successfully'
      WHEN 'FAILED_RETRYABLE' THEN 'Failed, will retry'
      WHEN 'FAILED_TERMINAL' THEN 'Failed permanently'
      WHEN 'CANCELLED' THEN 'Cancelled'
      ELSE 'Processing'
    END,
    NEW.priority,
    NEW.applicant_data->>'name',
    now(),
    NEW.created_at
  )
  ON CONFLICT (job_id) DO UPDATE SET
    current_state = EXCLUDED.current_state,
    status_text = EXCLUDED.status_text,
    priority = EXCLUDED.priority,
    last_transition_at = EXCLUDED.last_transition_at,
    hitl_pending = CASE WHEN NEW.status = 'WAITING_HITL' THEN true ELSE false END,
    completed_at = CASE WHEN NEW.status IN ('COMPLETED', 'FAILED_TERMINAL', 'CANCELLED') 
                        THEN now() ELSE job_status_summary.completed_at END;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update summary on job status change
CREATE TRIGGER trg_update_job_status_summary
  AFTER INSERT OR UPDATE OF status ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_job_status_summary();

-- Comments
COMMENT ON TABLE job_status_summary IS 'Denormalized view for fast portal queries';
COMMENT ON COLUMN job_status_summary.status_text IS 'Human-readable status message';
