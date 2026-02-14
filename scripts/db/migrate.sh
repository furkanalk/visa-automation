#!/bin/bash
# Run database migrations idempotently
# Usage: ./scripts/db/migrate.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$PROJECT_ROOT/packages/db/migrations"

# Database connection settings
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-visa_automation}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"

export PGPASSWORD="$DB_PASSWORD"

# Optional: mTLS (same as DB_SSL_* in app). psql uses libpq env vars.
if [[ -n "${DB_SSL_CA_PATH:-}" ]]; then
  export PGSSLROOTCERT="$DB_SSL_CA_PATH"
  export PGSSLMODE="${DB_SSL:-verify-full}"
fi
if [[ -n "${DB_SSL_CERT_PATH:-}" ]]; then export PGSSLCERT="$DB_SSL_CERT_PATH"; fi
if [[ -n "${DB_SSL_KEY_PATH:-}" ]]; then export PGSSLKEY="$DB_SSL_KEY_PATH"; fi

echo "Running migrations against $DB_HOST:$DB_PORT/$DB_NAME"

# Check if database exists
if ! psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -lqt | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
  echo "Creating database $DB_NAME..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -c "CREATE DATABASE $DB_NAME;"
fi

# Create schema_migrations table if not exists
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);"

# Run migrations in order
for migration in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  filename=$(basename "$migration")
  already_applied=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT 1 FROM schema_migrations WHERE filename = '$filename'")
  if [[ "$already_applied" == "1" ]]; then
    echo "SKIP: $filename (already applied)"
    continue
  fi
  echo "APPLY: $filename"
  if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$migration"; then
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "INSERT INTO schema_migrations (filename) VALUES ('$filename');"
    echo "✓ Applied: $filename"
  else
    echo "✗ FAILED: $filename (not recorded in schema_migrations)"
    exit 1
  fi
done

echo "All migrations completed (idempotent)!"
