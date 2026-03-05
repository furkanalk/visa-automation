#!/bin/bash
# Create the bootstrap super_admin account if it doesn't exist yet.
# Runs after migrations inside the postgres:alpine bootstrap container.
# Uses pgcrypto's crypt() for bcrypt — Node.js bcrypt accepts $2a$ hashes.
#
# Required env vars:
#   BOOTSTRAP_ADMIN_EMAIL    – login email
#   BOOTSTRAP_ADMIN_PASSWORD – plain-text password (min 8 chars)
# Optional:
#   BOOTSTRAP_ADMIN_NAME     – display name (default: "System Administrator")

set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-visa_automation}"
DB_USER="${DB_USER:-postgres}"

export PGPASSWORD="${DB_PASSWORD:-postgres}"

EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-}"
PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-}"
NAME="${BOOTSTRAP_ADMIN_NAME:-System Administrator}"

if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
  echo "[bootstrap-admin] BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD not set — skipping."
  exit 0
fi

if [[ "${#PASSWORD}" -lt 8 ]]; then
  echo "[bootstrap-admin] ERROR: BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters."
  exit 1
fi

# Lowercase email, escape single quotes for SQL
EMAIL_SQL="${EMAIL,,}"
EMAIL_SQL="${EMAIL_SQL//"'"/"''"}"
NAME_SQL="${NAME//"'"/"''"}"
PASS_SQL="${PASSWORD//"'"/"''"}"

# Default tenant id (from migration 015)
TENANT_ID='a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

echo "[bootstrap-admin] Ensuring super_admin exists for <${EMAIL,,}>..."

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<EOF
INSERT INTO staff_members (
  tenant_id, email, name, role, status,
  password_hash, permissions, settings, metrics, is_system
)
SELECT
  '${TENANT_ID}',
  '${EMAIL_SQL}',
  '${NAME_SQL}',
  'super_admin',
  'active',
  crypt('${PASS_SQL}', gen_salt('bf', 10)),
  '[]'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM staff_members
  WHERE tenant_id = '${TENANT_ID}' AND email = '${EMAIL_SQL}'
);
EOF

echo "[bootstrap-admin] ✓ Done."
