#!/usr/bin/env bash
# Prod: pull + run, no build. Usage: ./up.sh [extra docker compose up options...]
# Flow: Stage (CI) = build+push; Prod = pull+run (--no-build).
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.prod"
echo "Env: ${ENV_FILE}" >&2
cd "${SCRIPT_DIR}"
exec docker compose --env-file .env.prod -f compose.yml -f prod-override.yml up -d --no-build "$@"
