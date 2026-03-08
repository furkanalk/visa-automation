#!/bin/sh
set -e
# Ensure Playwright Chromium is installed (needed for job runs; idempotent when /app is volume-mounted)
cd /app && npx playwright install chromium

# Build packages/shared so node_modules/@visa-automation/shared/dist is up to date.
# In dev mode tsx runs TS directly, but shared is a pre-built package in node_modules
# and must be rebuilt whenever its source changes (e.g. transitions.ts).
echo "Building @visa-automation/shared..."
cd /app && npx tsc -p packages/shared/tsconfig.json
SRC=$(realpath /app/packages/shared/dist 2>/dev/null || echo "/app/packages/shared/dist")
DST=$(realpath /app/node_modules/@visa-automation/shared/dist 2>/dev/null || echo "/app/node_modules/@visa-automation/shared/dist")
if [ "$SRC" != "$DST" ]; then
  cp -r "$SRC/." "$DST/"
fi
echo "Shared package rebuilt."

exec "$@"
