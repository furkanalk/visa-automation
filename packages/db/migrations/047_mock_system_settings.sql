-- Migration 047: Add mock portal system settings
-- These settings control mock mode at runtime without requiring env var changes.
-- DP reads these via CP /cp/settings and refreshes every config_refresh_interval_ms (default 60s).
-- USE_MOCK_PORTAL env var on DP still overrides (hard override).

INSERT INTO system_settings (tenant_id, category, key, value, value_type, description)
VALUES
  (NULL, 'mock', 'enabled',          to_jsonb(false),                'Mock portal enabled (overrides USE_MOCK_PORTAL env var behaviour)',  'boolean'),
  (NULL, 'mock', 'default_base_url', to_jsonb('http://mock-portal:3004'::text), 'Mock portal base URL (Docker internal hostname)',  'string')
ON CONFLICT (tenant_id, category, key) DO NOTHING;
