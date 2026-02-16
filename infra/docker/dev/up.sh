#!/usr/bin/env bash
# Dev (local): build when needed, never pull. Usage: ./up.sh [extra docker compose up options...]
# Flow: Stage (CI) = build+push; Test/Prod = pull+run (no build); Dev = build + --pull=never.
set -e
# Use BuildKit for faster npm cache in Dockerfile RUN --mount=type=cache
export DOCKER_BUILDKIT=1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.dev"
echo "Env: ${ENV_FILE}" >&2
cd "${SCRIPT_DIR}"
exec docker compose --env-file .env.dev -f compose.yml -f dev-override.yml up -d --build --pull=never "$@"
