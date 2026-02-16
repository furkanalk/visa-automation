-- Migration: 022_default_profile
-- Bootstrap default agent profile for default tenant. Agent-specific settings (not portal).
-- Default profile is undeletable (is_default = true).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM agent_profiles
    WHERE tenant_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' AND is_default = true
  ) THEN
    INSERT INTO agent_profiles (tenant_id, name, description, config, is_default)
    VALUES (
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'Default',
      'Bootstrap default profile. Agent pacing, rate limits, timeouts and retries.',
      '{
        "config_priority": "portal_over_profile",
        "rateLimit": { "rpm": 30, "rph": 500 },
        "pacing": { "minMs": 500, "maxMs": 2000 },
        "slotHunt": { "maxPolls": 100, "sleepMinMs": 5000, "sleepMaxMs": 15000 },
        "timeouts": { "navigationMs": 30000, "actionMs": 10000, "pageLoadMs": 60000 },
        "retry": { "maxAttempts": 3, "delayMs": 5000, "backoffMultiplier": 2 }
      }'::jsonb,
      true
    );
  END IF;
END $$;
