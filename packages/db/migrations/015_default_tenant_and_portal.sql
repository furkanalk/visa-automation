-- Migration: 015_default_tenant_and_portal
-- Default tenant (slug 'default') and as-visa portal config. Required for DP; no file fallback.

-- Default tenant (same id as seed so x-tenant-id: default works)
INSERT INTO tenants (id, name, slug, config, status)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'Default',
  'default',
  '{"max_concurrent_jobs": 10, "default_priority": 50, "notification_channels": ["EMAIL"], "hitl_timeout_minutes": 30}'::jsonb,
  'ACTIVE'
)
ON CONFLICT (slug) DO NOTHING;

-- as-visa portal config for default tenant (DP reads from CP only)
INSERT INTO portal_configs (tenant_id, portal_id, name, base_url, enabled, config, selectors)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'as-visa',
  'AS Visa',
  'https://appointment.as-visa.com/tr/ankara-bireysel-basvuru',
  true,
  '{
    "timeouts": { "navigationMs": 60000, "actionMs": 20000 },
    "pacing": { "minDelayMs": 250, "maxDelayMs": 900, "jitter": 0.35 },
    "rateLimit": { "enabled": true, "actionsPerMinute": 20, "burst": 4 },
    "proxy": { "enabled": false, "strategy": "off", "providers": [] },
    "hitl": { "otpMode": "pause", "captchaMode": "hitl", "maxWaitSeconds": 180 },
    "selectorsVersion": "v1"
  }'::jsonb,
  '{}'::jsonb
)
ON CONFLICT (tenant_id, portal_id) DO NOTHING;
