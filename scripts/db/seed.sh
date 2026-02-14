#!/bin/bash
# Optional: seed demo data only (tenants/jobs for local try-out).
# Required data (default tenant, as-visa portal, system_settings) comes from migrations only.

set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-visa_automation}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

export PGPASSWORD="$DB_PASSWORD"

echo "Seeding demo data into $DB_HOST:$DB_PORT/$DB_NAME"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<'EOF'
-- Demo tenant
INSERT INTO tenants (id, name, slug, config, status)
VALUES (
  'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
  'Demo Logistics Corp',
  'demo-logistics',
  '{"max_concurrent_jobs": 10, "default_priority": 50, "notification_channels": ["EMAIL", "WEBHOOK"], "hitl_timeout_minutes": 30}'::jsonb,
  'ACTIVE'
)
ON CONFLICT (slug) DO NOTHING;

-- Demo: sample job (uses default tenant from migration 015)
INSERT INTO jobs (id, tenant_id, visa_type, status, priority, applicant_data, config)
VALUES (
  'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'SCHENGEN',
  'QUEUED',
  50,
  '{"name": "John Doe", "passport_number": "AB1234567", "nationality": "US", "email": "john.doe@example.com"}'::jsonb,
  '{"target_site": "https://example-visa-portal.com", "simulate_hitl": false}'::jsonb
)
ON CONFLICT DO NOTHING;
EOF

echo "✓ Demo seed done. Default tenant + as-visa portal come from migrations (db:migrate)."
