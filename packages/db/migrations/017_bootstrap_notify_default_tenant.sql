-- Migration 017: Ensure default tenant has a notify_settings row (bootstrap/first-run).
-- CP would create on first GET /cp/notify anyway; this makes bootstrap explicit and idempotent.

INSERT INTO notify_settings (tenant_id)
VALUES ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
ON CONFLICT (tenant_id) DO NOTHING;
