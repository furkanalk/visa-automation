#!/bin/sh
set -e
# Ensure Playwright Chromium is installed (needed for job runs; idempotent when /app is volume-mounted)
cd /app && npx playwright install chromium

# Build packages/shared so node_modules/@visa-automation/shared/dist is up to date.
# In dev mode tsx runs TS directly, but shared is a pre-built package in node_modules
# and must be rebuilt whenever its source changes (e.g. transitions.ts).
echo "Building @visa-automation/shared..."
cd /app && npx tsc -p packages/shared/tsconfig.json
cp -r /app/packages/shared/dist/. /app/node_modules/@visa-automation/shared/dist/
echo "Shared package rebuilt."

exec "$@"
