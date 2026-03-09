import type { FastifyPluginAsync } from 'fastify';
import { getDb, SystemSettingsRepository } from '@visa-automation/db';

const MOCK_TIMEOUT_MS = 8000;

/** Normalize string from DB JSONB (may be double-quoted). */
function normalizeString(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t) as string; } catch { return t; }
  }
  return t;
}

/** Resolve the mock portal base URL (origin) for a given portalId from tenant settings. */
async function resolveMockOrigin(tenantId: string, portalId: string): Promise<string | null> {
  const db = getDb();
  const settingsRepo = new SystemSettingsRepository(db);

  const mockEnabled =
    (await settingsRepo.getBoolean(tenantId, 'mock', 'enabled', false)) ||
    (await settingsRepo.getBoolean(null, 'mock', 'enabled', false)) ||
    !!process.env.MOCK_PORTAL_BASE_URL;

  if (!mockEnabled) return null;

  const portalUrlsRaw =
    (await settingsRepo.getJson<Record<string, unknown>>(tenantId, 'mock', 'portal_urls', {})) ||
    (await settingsRepo.getJson<Record<string, unknown>>(null, 'mock', 'portal_urls', {})) ||
    {};

  // Per-portal override
  const perPortal = normalizeString(portalUrlsRaw[portalId]);
  if (perPortal) {
    try { return new URL(perPortal).origin; } catch { /* ignore */ }
  }

  // Default base URL — DB first, then fall back to MOCK_PORTAL_BASE_URL env var
  const defaultBase = normalizeString(
    (await settingsRepo.getString(tenantId, 'mock', 'default_base_url', '')) ||
    (await settingsRepo.getString(null, 'mock', 'default_base_url', '')) ||
    process.env.MOCK_PORTAL_BASE_URL ||
    ''
  );
  if (defaultBase) {
    try { return new URL(defaultBase).origin; } catch { /* ignore */ }
  }

  return null;
}

interface MockPortalParams {
  portalId: string;
}

/**
 * Proxy routes to the mock portal's own /api/config endpoint.
 * The browser can't reach `mock-portal:3004` (Docker internal), so CP proxies on its behalf.
 *
 * GET  /cp/mock-portal/:portalId/config  → GET  {mockOrigin}/api/config/:portalId
 * POST /cp/mock-portal/:portalId/config  → POST {mockOrigin}/api/config/:portalId  (body forwarded)
 */
export const mockPortalRoutes: FastifyPluginAsync = async (app) => {
  // GET config for a specific portal
  app.get<{ Params: MockPortalParams }>('/:portalId/config', async (request, reply) => {
    const { portalId } = request.params;
    const origin = await resolveMockOrigin(request.tenantId, portalId);

    if (!origin) {
      return reply.status(503).send({
        success: false,
        error: { code: 'MOCK_NOT_CONFIGURED', message: 'Mock mode is not enabled or mock URL is not configured.' },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MOCK_TIMEOUT_MS);
    try {
      const res = await fetch(`${origin}/api/config/${encodeURIComponent(portalId)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const body = await res.json() as unknown;
      return reply.status(res.status).send(body);
    } catch (err) {
      clearTimeout(timeout);
      if (reply.sent) return;
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({
        success: false,
        error: { code: 'MOCK_PORTAL_UNREACHABLE', message: `Could not reach mock portal: ${msg}` },
      });
    }
  });

  // POST config update for a specific portal
  app.post<{ Params: MockPortalParams; Body: unknown }>('/:portalId/config', async (request, reply) => {
    const { portalId } = request.params;
    const origin = await resolveMockOrigin(request.tenantId, portalId);

    if (!origin) {
      return reply.status(503).send({
        success: false,
        error: { code: 'MOCK_NOT_CONFIGURED', message: 'Mock mode is not enabled or mock URL is not configured.' },
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MOCK_TIMEOUT_MS);
    try {
      const res = await fetch(`${origin}/api/config/${encodeURIComponent(portalId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const body = await res.json() as unknown;
      return reply.status(res.status).send(body);
    } catch (err) {
      clearTimeout(timeout);
      if (reply.sent) return;
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({
        success: false,
        error: { code: 'MOCK_PORTAL_UNREACHABLE', message: `Could not reach mock portal: ${msg}` },
      });
    }
  });
};
