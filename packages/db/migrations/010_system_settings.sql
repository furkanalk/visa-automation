-- Migration 010: System Settings for centralized configuration
-- Stores tenant-scoped and global configuration values

CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  value_type TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'json', 'array')),
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by TEXT,
  
  -- Unique constraint: one key per tenant (or global if tenant_id is null)
  CONSTRAINT uq_system_settings_tenant_key UNIQUE (tenant_id, category, key)
);

-- Indexes for fast lookups (idempotent)
CREATE INDEX IF NOT EXISTS idx_system_settings_tenant ON system_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category);
CREATE INDEX IF NOT EXISTS idx_system_settings_tenant_category ON system_settings(tenant_id, category);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_system_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_system_settings_updated
  BEFORE UPDATE ON system_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_system_settings_timestamp();

-- Insert default global settings (tenant_id = NULL means global). value is JSONB: use to_jsonb() for valid JSON.
INSERT INTO system_settings (tenant_id, category, key, value, description, value_type) VALUES
  -- System settings
  (NULL, 'system', 'heartbeat_interval_ms', to_jsonb(10000), 'Agent heartbeat interval in milliseconds', 'number'),
  (NULL, 'system', 'heartbeat_timeout_ms', to_jsonb(30000), 'Heartbeat timeout before marking agent offline', 'number'),
  (NULL, 'system', 'config_refresh_interval_ms', to_jsonb(60000), 'Config refresh interval from CP', 'number'),
  (NULL, 'system', 'sync_poll_interval_ms', to_jsonb(5000), 'Sync agent polling interval', 'number'),
  (NULL, 'system', 'max_agents_per_worker', to_jsonb(100), 'Maximum agents per worker process', 'number'),
  (NULL, 'system', 'default_async_agent_count', to_jsonb(2), 'Default async agents to spawn', 'number'),
  (NULL, 'system', 'default_sync_agent_count', to_jsonb(0), 'Default sync agents to spawn', 'number'),
  (NULL, 'system', 'max_concurrent_jobs', to_jsonb(50), 'Maximum concurrent jobs system-wide', 'number'),
  -- Job settings
  (NULL, 'job', 'max_retries', to_jsonb(3), 'Maximum retry attempts for failed jobs', 'number'),
  (NULL, 'job', 'default_priority', to_jsonb(50), 'Default job priority (1-100)', 'number'),
  (NULL, 'job', 'lock_timeout_ms', to_jsonb(300000), 'Job processing lock timeout (5 min)', 'number'),
  (NULL, 'job', 'retry_slot_delay_min_ms', to_jsonb(30000), 'Minimum delay for slot retry', 'number'),
  (NULL, 'job', 'retry_slot_delay_max_ms', to_jsonb(90000), 'Maximum delay for slot retry', 'number'),
  -- Queue settings
  (NULL, 'queue', 'rate_limit_max', to_jsonb(10), 'Max jobs per rate limit window', 'number'),
  (NULL, 'queue', 'rate_limit_window_ms', to_jsonb(1000), 'Rate limit window duration', 'number'),
  (NULL, 'queue', 'completed_retention_hours', to_jsonb(24), 'Hours to keep completed jobs', 'number'),
  (NULL, 'queue', 'completed_max_count', to_jsonb(1000), 'Max completed jobs to retain', 'number'),
  (NULL, 'queue', 'failed_retention_hours', to_jsonb(168), 'Hours to keep failed jobs (7 days)', 'number'),
  (NULL, 'queue', 'failed_max_count', to_jsonb(5000), 'Max failed jobs to retain', 'number'),
  -- Portal defaults
  (NULL, 'portal', 'navigation_timeout_ms', to_jsonb(45000), 'Default navigation timeout', 'number'),
  (NULL, 'portal', 'action_timeout_ms', to_jsonb(15000), 'Default action timeout', 'number'),
  (NULL, 'portal', 'selector_timeout_ms', to_jsonb(30000), 'Default selector wait timeout', 'number'),
  (NULL, 'portal', 'pacing_min_delay_ms', to_jsonb(250), 'Minimum delay between actions', 'number'),
  (NULL, 'portal', 'pacing_max_delay_ms', to_jsonb(900), 'Maximum delay between actions', 'number'),
  (NULL, 'portal', 'pacing_jitter', to_jsonb(0.35), 'Jitter factor for random delays', 'number'),
  (NULL, 'portal', 'rate_limit_actions_per_minute', to_jsonb(30), 'Max actions per minute', 'number'),
  (NULL, 'portal', 'rate_limit_burst', to_jsonb(6), 'Burst allowance', 'number'),
  -- Slot hunt settings
  (NULL, 'slot_hunt', 'max_polls', to_jsonb(12), 'Maximum polling attempts', 'number'),
  (NULL, 'slot_hunt', 'poll_delay_min_ms', to_jsonb(1500), 'Min delay between polls', 'number'),
  (NULL, 'slot_hunt', 'poll_delay_max_ms', to_jsonb(3000), 'Max delay between polls', 'number'),
  -- HITL settings
  (NULL, 'hitl', 'task_timeout_minutes', to_jsonb(30), 'HITL task timeout', 'number'),
  (NULL, 'hitl', 'max_wait_seconds', to_jsonb(180), 'Max wait for HITL response', 'number'),
  -- Notification settings
  (NULL, 'notify', 'dedupe_slot_open_ttl_seconds', to_jsonb(600), 'Dedupe TTL for slot open (10 min)', 'number'),
  (NULL, 'notify', 'dedupe_booking_ttl_seconds', to_jsonb(86400), 'Dedupe TTL for booking (24h)', 'number'),
  (NULL, 'notify', 'dedupe_slot_closed_ttl_seconds', to_jsonb(1800), 'Dedupe TTL for slot closed (30 min)', 'number'),
  (NULL, 'notify', 'slot_status_ttl_seconds', to_jsonb(172800), 'Slot status cache TTL (2 days)', 'number'),
  -- Browser settings
  (NULL, 'browser', 'viewport_width', to_jsonb(1366), 'Browser viewport width', 'number'),
  (NULL, 'browser', 'viewport_height', to_jsonb(768), 'Browser viewport height', 'number'),
  -- Pagination defaults
  (NULL, 'pagination', 'default_page_size', to_jsonb(20), 'Default items per page', 'number'),
  (NULL, 'pagination', 'max_page_size', to_jsonb(100), 'Maximum items per page', 'number'),
  -- Watcher settings
  (NULL, 'watcher', 'estimated_time_per_portal_ms', to_jsonb(30000), 'Estimated capture time per portal', 'number'),
  (NULL, 'watcher', 'snapshots_default_limit', to_jsonb(50), 'Default snapshots to return', 'number'),
  (NULL, 'watcher', 'snapshots_max_limit', to_jsonb(200), 'Max snapshots to return', 'number'),
  -- Audit settings
  (NULL, 'audit', 'default_limit', to_jsonb(20), 'Default audit logs to return', 'number'),
  (NULL, 'audit', 'recent_max_limit', to_jsonb(100), 'Max recent audit logs', 'number'),
  (NULL, 'audit', 'export_max_limit', to_jsonb(10000), 'Max logs for export', 'number'),
  (NULL, 'audit', 'export_default_days', to_jsonb(30), 'Default export period in days', 'number'),
  -- Feature flags
  (NULL, 'features', 'watcher_enabled', to_jsonb(true), 'Enable site drift watcher', 'boolean'),
  (NULL, 'features', 'hitl_enabled', to_jsonb(true), 'Enable human-in-the-loop', 'boolean'),
  (NULL, 'features', 'notifications_enabled', to_jsonb(true), 'Enable notifications', 'boolean'),
  -- FSM settings
  (NULL, 'fsm', 'state_transition_delay_ms', to_jsonb(500), 'Delay between FSM state transitions', 'number'),
  -- Health check settings
  (NULL, 'health', 'redis_timeout_ms', to_jsonb(2000), 'Redis health check timeout', 'number')
ON CONFLICT (tenant_id, category, key) DO NOTHING;

COMMENT ON TABLE system_settings IS 'Centralized configuration store for runtime-configurable settings';
COMMENT ON COLUMN system_settings.tenant_id IS 'NULL for global settings, UUID for tenant-specific';
COMMENT ON COLUMN system_settings.category IS 'Logical grouping (system, job, portal, etc)';
COMMENT ON COLUMN system_settings.is_sensitive IS 'If true, value should be redacted in logs/API';
