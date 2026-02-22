-- Migration 028: Job screenshots for HITL (DP uploads, CP serves)
-- Used when HITL triggers so staff/admin can view the page screenshot

CREATE TABLE IF NOT EXISTS job_screenshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'image/png',
  data BYTEA NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT uq_job_screenshots_job_filename UNIQUE (job_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_job_screenshots_job_id ON job_screenshots(job_id);

COMMENT ON TABLE job_screenshots IS 'Screenshots uploaded by DP when HITL triggers; served by CP for staff/admin';
