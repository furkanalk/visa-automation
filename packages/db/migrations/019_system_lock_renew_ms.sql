-- Migration 019: Agent job lock renewal interval (system_settings)
INSERT INTO system_settings (tenant_id, category, key, value, description, value_type) VALUES
  (NULL, 'system', 'lock_renew_ms', to_jsonb(300000), 'Agent job lock renewal interval in milliseconds (5 min)', 'number')
ON CONFLICT (tenant_id, category, key) DO NOTHING;
