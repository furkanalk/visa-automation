#!/bin/bash
# Seed database with demo data
# Usage: ./scripts/db/seed.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Database connection settings
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-visa_automation}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

export PGPASSWORD="$DB_PASSWORD"

echo "Seeding database $DB_HOST:$DB_PORT/$DB_NAME"

# Insert demo tenant
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<EOF
-- Insert demo tenant
INSERT INTO tenants (id, name, slug, config, status)
VALUES (
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'Demo Logistics Corp',
  'demo-logistics',
  '{
    "max_concurrent_jobs": 10,
    "default_priority": 50,
    "notification_channels": ["EMAIL", "WEBHOOK"],
    "webhook_url": "https://example.com/webhook",
    "hitl_timeout_minutes": 30
  }',
  'ACTIVE'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  config = EXCLUDED.config;

-- Insert a sample job for testing
INSERT INTO jobs (id, tenant_id, visa_type, status, priority, applicant_data, config)
VALUES (
  'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'SCHENGEN',
  'QUEUED',
  50,
  '{
    "name": "John Doe",
    "passport_number": "AB1234567",
    "nationality": "US",
    "email": "john.doe@example.com"
  }',
  '{
    "target_site": "https://example-visa-portal.com",
    "simulate_hitl": false
  }'
)
ON CONFLICT DO NOTHING;

SELECT 'Seeding complete!' as status;
EOF

echo "✓ Database seeded successfully!"
echo ""
echo "Demo tenant ID: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
echo "Demo tenant slug: demo-logistics"
