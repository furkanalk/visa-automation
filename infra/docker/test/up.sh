#!/usr/bin/env bash
# Test: pull + run, no build. Usage: ./up.sh [extra docker compose up options...]
# Flow: Stage (CI) = build+push; Test = pull+run (--no-build).
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.test"
echo "Env: ${ENV_FILE}" >&2
cd "${SCRIPT_DIR}"
exec docker compose --env-file .env.test -f compose.yml -f test-override.yml up -d --no-build "$@"
