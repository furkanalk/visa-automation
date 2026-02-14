-- Migration 016: Notify action token and base URL in system_settings (for CP public-jobs and DP)
-- Replaces env NOTIFY_ACTION_TOKEN / NOTIFY_ACTION_BASE_URL

INSERT INTO system_settings (tenant_id, category, key, value, description, value_type, is_sensitive) VALUES
  (NULL, 'notify', 'notify_action_token', '"changeme"', 'Token for Telegram stop/ack action links (public API)', 'string', true),
  (NULL, 'notify', 'notify_action_base_url', '"http://localhost:3000"', 'Base URL for notification action links', 'string', false)
ON CONFLICT (tenant_id, category, key) DO NOTHING;
