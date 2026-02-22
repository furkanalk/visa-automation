#!/bin/sh
set -e
# Ensure Playwright Chromium is installed (needed for job runs; idempotent when /app is volume-mounted)
cd /app && npx playwright install chromium
exec "$@"
