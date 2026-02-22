-- Add is_scout to agent_profiles: when true, agents with this profile consume only from slot-check queue (watcher/scout).
ALTER TABLE agent_profiles
  ADD COLUMN IF NOT EXISTS is_scout BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN agent_profiles.is_scout IS 'When true, agents with this profile only process slot-check (watcher) jobs from the scout queue';

CREATE INDEX IF NOT EXISTS idx_agent_profiles_is_scout ON agent_profiles(tenant_id) WHERE is_scout = true;
