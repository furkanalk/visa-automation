-- Track which agent ran each job run (for job details UI)
ALTER TABLE job_runs
  ADD COLUMN IF NOT EXISTS agent_id UUID NULL REFERENCES agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_runs_agent_id ON job_runs (agent_id);
COMMENT ON COLUMN job_runs.agent_id IS 'Agent that executed this run (DP worker assigns when starting)';
