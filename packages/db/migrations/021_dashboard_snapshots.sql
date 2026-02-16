-- Migration: 021_dashboard_snapshots
-- Description: Time-series snapshots for admin dashboard (agent/job activity). Retention 7 days.

CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  online_agents INT NOT NULL DEFAULT 0,
  total_agents  INT NOT NULL DEFAULT 0,
  active_jobs   INT NOT NULL DEFAULT 0,
  total_jobs    INT NOT NULL DEFAULT 0,
  completed_jobs INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_recorded_at ON dashboard_snapshots(recorded_at);

COMMENT ON TABLE dashboard_snapshots IS '5-min snapshots for dashboard activity graph; retain 7 days';
