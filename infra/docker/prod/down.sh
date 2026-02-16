#!/usr/bin/env bash
# Prod: stop and remove containers. Usage: ./down.sh [extra docker compose down options...]
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"
exec docker compose --env-file .env.prod -f compose.yml -f prod-override.yml down "$@"
