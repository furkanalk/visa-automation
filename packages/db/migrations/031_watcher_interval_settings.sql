-- Migration 031: Watcher slot-check interval (fixed or random) – configurable from Admin Watcher page
INSERT INTO system_settings (tenant_id, category, key, value, description, value_type) VALUES
  (NULL, 'system', 'watcher_interval_ms', to_jsonb(300000), 'Fallback: slot-check interval in ms (5 min). Use watcher_interval_* for config.', 'number'),
  (NULL, 'system', 'watcher_interval_mode', to_jsonb('random'), 'fixed = same interval every time; random = pick between min and max each run', 'string'),
  (NULL, 'system', 'watcher_interval_fixed_minutes', to_jsonb(5), 'When mode=fixed: interval in minutes', 'number'),
  (NULL, 'system', 'watcher_interval_random_min_minutes', to_jsonb(3), 'When mode=random: minimum interval in minutes', 'number'),
  (NULL, 'system', 'watcher_interval_random_max_minutes', to_jsonb(10), 'When mode=random: maximum interval in minutes', 'number')
ON CONFLICT (tenant_id, category, key) DO NOTHING;
