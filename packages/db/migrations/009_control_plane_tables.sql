-- Migration: 009_control_plane_tables
-- Description: Create Control Plane tables for agent management, profiles, portal configs, notifications, watcher, and audit logs

-- ============================================
-- 1. AGENT MODE AND STATUS ENUMS
-- ============================================

DO $$ BEGIN
  CREATE TYPE agent_mode AS ENUM ('ASYNC', 'SYNC');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_status AS ENUM ('ONLINE', 'OFFLINE', 'DISABLED', 'DRAINING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- 2. AGENTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS agents (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  mode                  agent_mode NOT NULL DEFAULT 'ASYNC',
  status                agent_status NOT NULL DEFAULT 'OFFLINE',
  profile_id            UUID,
  desired_portals       JSONB NOT NULL DEFAULT '[]'::jsonb,
  desired_concurrency   INT NOT NULL DEFAULT 1,
  current_job_id        UUID,
  last_heartbeat_at     TIMESTAMPTZ,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for agents
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
CREATE INDEX IF NOT EXISTS idx_agents_tenant_status ON agents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_profile ON agents(profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(last_heartbeat_at) WHERE status = 'ONLINE';

-- Comments
COMMENT ON TABLE agents IS 'Logical worker instances managed by the Control Plane';
COMMENT ON COLUMN agents.mode IS 'ASYNC = pulls from queue, SYNC = triggered via API';
COMMENT ON COLUMN agents.desired_portals IS 'Array of portal IDs this agent is assigned to';
COMMENT ON COLUMN agents.desired_concurrency IS 'Max concurrent jobs (usually 1 for SYNC agents)';

-- ============================================
-- 3. AGENT PROFILES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS agent_profiles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for agent_profiles
CREATE INDEX IF NOT EXISTS idx_agent_profiles_tenant ON agent_profiles(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_default ON agent_profiles(tenant_id) WHERE is_default = true;

-- Add foreign key from agents to agent_profiles
ALTER TABLE agents
  ADD CONSTRAINT fk_agents_profile
  FOREIGN KEY (profile_id) REFERENCES agent_profiles(id) ON DELETE SET NULL;

-- Comments
COMMENT ON TABLE agent_profiles IS 'Configuration profiles for agents (pacing, rate limits, timeouts)';
COMMENT ON COLUMN agent_profiles.config IS 'JSON config: rateLimit, pacing, slotHunt, timeouts, etc.';
COMMENT ON COLUMN agent_profiles.is_default IS 'Only one default profile per tenant';

-- ============================================
-- 4. PORTAL CONFIGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS portal_configs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  base_url    TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  selectors   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one config per portal per tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_config_tenant_portal ON portal_configs(tenant_id, portal_id);

-- Indexes for portal_configs
CREATE INDEX IF NOT EXISTS idx_portal_configs_tenant ON portal_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_portal_configs_enabled ON portal_configs(tenant_id, enabled) WHERE enabled = true;

-- Comments
COMMENT ON TABLE portal_configs IS 'Per-portal configuration overrides and settings';
COMMENT ON COLUMN portal_configs.portal_id IS 'Unique identifier for the portal (e.g., as-visa, idata-ita)';
COMMENT ON COLUMN portal_configs.config IS 'Portal-specific config: pacing, concurrency, circuit breaker';
COMMENT ON COLUMN portal_configs.selectors IS 'DOM selectors for the portal pages';

-- ============================================
-- 5. NOTIFY SETTINGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS notify_settings (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  telegram_enabled    BOOLEAN NOT NULL DEFAULT true,
  telegram_bot_token  TEXT,
  telegram_chat_ids   TEXT[] NOT NULL DEFAULT '{}',
  email_enabled       BOOLEAN NOT NULL DEFAULT true,
  smtp_host           TEXT,
  smtp_port           INT DEFAULT 587,
  smtp_user           TEXT,
  smtp_pass           TEXT,
  smtp_from           TEXT,
  smtp_secure         BOOLEAN NOT NULL DEFAULT true,
  fallback_email      TEXT,
  email_override      TEXT,
  webhook_enabled     BOOLEAN NOT NULL DEFAULT false,
  webhook_url         TEXT,
  webhook_secret      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for notify_settings
CREATE INDEX IF NOT EXISTS idx_notify_settings_tenant ON notify_settings(tenant_id);

-- Comments
COMMENT ON TABLE notify_settings IS 'Per-tenant notification channel settings';
COMMENT ON COLUMN notify_settings.telegram_chat_ids IS 'Array of Telegram chat IDs to notify';
COMMENT ON COLUMN notify_settings.email_override IS 'If set, all emails go here instead of customer email';

-- ============================================
-- 6. WATCHER CONFIG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS watcher_config (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  enabled             BOOLEAN NOT NULL DEFAULT false,
  window_start_hour   INT NOT NULL DEFAULT 8 CHECK (window_start_hour >= 0 AND window_start_hour <= 23),
  window_end_hour     INT NOT NULL DEFAULT 22 CHECK (window_end_hour >= 0 AND window_end_hour <= 23),
  jitter_minutes      INT NOT NULL DEFAULT 30 CHECK (jitter_minutes >= 0),
  portals             JSONB NOT NULL DEFAULT '[]'::jsonb,
  notify_on_change    BOOLEAN NOT NULL DEFAULT true,
  last_run_at         TIMESTAMPTZ,
  next_scheduled_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for watcher_config
CREATE INDEX IF NOT EXISTS idx_watcher_config_tenant ON watcher_config(tenant_id);
CREATE INDEX IF NOT EXISTS idx_watcher_config_enabled ON watcher_config(enabled) WHERE enabled = true;

-- Comments
COMMENT ON TABLE watcher_config IS 'Site drift detection configuration per tenant';
COMMENT ON COLUMN watcher_config.window_start_hour IS 'Hour of day (0-23) to start watcher window';
COMMENT ON COLUMN watcher_config.window_end_hour IS 'Hour of day (0-23) to end watcher window';
COMMENT ON COLUMN watcher_config.jitter_minutes IS 'Random jitter in minutes for scheduling';
COMMENT ON COLUMN watcher_config.portals IS 'Array of portal IDs to watch';

-- ============================================
-- 7. PORTAL SNAPSHOTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS portal_snapshots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portal_id     TEXT NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  html_hash     TEXT NOT NULL,
  html          TEXT NOT NULL,
  dom_digest    JSONB,
  screenshot_path TEXT,
  diff_summary  TEXT,
  diff_severity TEXT CHECK (diff_severity IN ('none', 'low', 'medium', 'high', 'critical')),
  previous_snapshot_id UUID REFERENCES portal_snapshots(id),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Indexes for portal_snapshots
CREATE INDEX IF NOT EXISTS idx_portal_snapshots_tenant ON portal_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_portal_snapshots_portal ON portal_snapshots(portal_id);
CREATE INDEX IF NOT EXISTS idx_portal_snapshots_tenant_portal ON portal_snapshots(tenant_id, portal_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_snapshots_captured ON portal_snapshots(captured_at DESC);

-- Comments
COMMENT ON TABLE portal_snapshots IS 'HTML snapshots for site drift detection';
COMMENT ON COLUMN portal_snapshots.html_hash IS 'SHA-256 hash of HTML content for quick comparison';
COMMENT ON COLUMN portal_snapshots.dom_digest IS 'Structured digest of key DOM elements';
COMMENT ON COLUMN portal_snapshots.diff_severity IS 'Severity of changes detected';

-- ============================================
-- 8. AUDIT LOGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE SET NULL,
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'api', 'agent')),
  actor_id      TEXT,
  actor_name    TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT,
  changes       JSONB,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- Comments
COMMENT ON TABLE audit_logs IS 'Immutable audit trail for all admin/CP actions';
COMMENT ON COLUMN audit_logs.actor_type IS 'Type of actor: user, system, api, agent';
COMMENT ON COLUMN audit_logs.changes IS 'JSON diff of what changed (before/after)';

-- ============================================
-- 9. TRIGGER: AUTO-UPDATE updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all CP tables with updated_at
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['agents', 'agent_profiles', 'portal_configs', 'notify_settings', 'watcher_config'])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I; 
       CREATE TRIGGER trg_%I_updated_at 
       BEFORE UPDATE ON %I 
       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END $$;

-- ============================================
-- 10. SEED DEFAULT NOTIFY SETTINGS FUNCTION
-- ============================================

-- Function to ensure notify_settings exists for a tenant
CREATE OR REPLACE FUNCTION ensure_notify_settings(p_tenant_id UUID)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM notify_settings WHERE tenant_id = p_tenant_id;
  IF v_id IS NULL THEN
    INSERT INTO notify_settings (tenant_id)
    VALUES (p_tenant_id)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Function to ensure watcher_config exists for a tenant
CREATE OR REPLACE FUNCTION ensure_watcher_config(p_tenant_id UUID)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM watcher_config WHERE tenant_id = p_tenant_id;
  IF v_id IS NULL THEN
    INSERT INTO watcher_config (tenant_id)
    VALUES (p_tenant_id)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Comments for functions
COMMENT ON FUNCTION ensure_notify_settings IS 'Ensures notify_settings row exists for tenant, creates if missing';
COMMENT ON FUNCTION ensure_watcher_config IS 'Ensures watcher_config row exists for tenant, creates if missing';
