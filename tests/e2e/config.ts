/** E2E config. Override with env. Prerequisites: CP, DP, mock-portal, Redis, Postgres. */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
export const MOCK_PORTAL_URL = process.env.E2E_MOCK_PORTAL_URL ?? 'http://localhost:3004';
export const TENANT_ID = process.env.E2E_TENANT_ID ?? 'default';
export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 120000;
