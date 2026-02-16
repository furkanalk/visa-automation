#!/usr/bin/env bash
# Test: stop and remove containers. Usage: ./down.sh [extra docker compose down options...]
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"
exec docker compose --env-file .env.test -f compose.yml -f test-override.yml down "$@"
