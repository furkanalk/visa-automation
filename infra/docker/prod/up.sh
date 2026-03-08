#!/usr/bin/env bash
# Prod: pull + run, no build. Usage: ./up.sh [extra docker compose up options...]
# Flow: Stage (CI) = build+push to GHCR; Deploy (CI) = scp infra files + pull + run.
# .env.prod lives at ~/visa-automation-env/.env.prod (never in the repo).
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"
ENV_FILE="${HOME}/visa-automation-env/.env.prod"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found. Create it first:" >&2
  echo "  mkdir -p ~/visa-automation-env && cp .env.prod.example ~/visa-automation-env/.env.prod" >&2
  exit 1
fi
echo "Pulling latest images..." >&2
docker compose --env-file "${ENV_FILE}" -f compose.yml -f prod-override.yml pull
exec docker compose --env-file "${ENV_FILE}" -f compose.yml -f prod-override.yml up -d --no-build "$@"
