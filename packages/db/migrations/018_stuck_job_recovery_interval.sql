-- Migration 018: Stuck job recovery interval (CP worker) – from system_settings, no env default
INSERT INTO system_settings (tenant_id, category, key, value, description, value_type) VALUES
  (NULL, 'system', 'stuck_job_recovery_interval_ms', to_jsonb(60000), 'Interval for stuck RUNNING job recovery (reset expired locks)', 'number')
ON CONFLICT (tenant_id, category, key) DO NOTHING;
