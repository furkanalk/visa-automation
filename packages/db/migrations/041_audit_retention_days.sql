-- Audit log retention: configurable days to keep (global setting)
INSERT INTO system_settings (tenant_id, category, key, value, description, value_type) VALUES
  (NULL, 'audit', 'retention_days', to_jsonb(90), 'Days to keep audit logs before pruning', 'number')
ON CONFLICT (tenant_id, category, key) DO NOTHING;
