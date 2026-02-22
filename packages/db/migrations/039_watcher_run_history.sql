-- Watcher run history: one row per run (manual or scheduled), 7-day retention
CREATE TABLE IF NOT EXISTS watcher_run_history (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  portals_checked   JSONB NOT NULL DEFAULT '[]'::jsonb,
  jobs_created      INT NOT NULL DEFAULT 0,
  up_portal_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  down_portal_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  up_portals_with_no_customers JSONB NOT NULL DEFAULT '[]'::jsonb,
  message           TEXT
);

CREATE INDEX IF NOT EXISTS idx_watcher_run_history_tenant_run_at ON watcher_run_history(tenant_id, run_at DESC);
COMMENT ON TABLE watcher_run_history IS 'Watcher run history; prune rows older than 7 days';
