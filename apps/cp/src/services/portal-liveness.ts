import type { FastifyBaseLogger } from 'fastify';
import { getDb, PortalConfigRepository, SystemSettingsRepository } from '@visa-automation/db';

const LIVENESS_TIMEOUT_MS = 8000;

/** Normalize string from DB (JSONB may return string; strip surrounding quotes if present). */
function normalizeString(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string;
    } catch {
      return t;
    }
  }
  return t;
}

export interface LivenessItem {
  portal_id: string;
  name: string;
  status: 'up' | 'down';
  checked_at: string;
}

/**
 * Check a single URL (HEAD then GET fallback). Used by liveness route and watcher worker
 * when not in mock mode.
 */
export async function checkUrl(url: string): Promise<'up' | 'down'> {
  if (!url) return 'down';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIVENESS_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
      // 405 Method Not Allowed = HEAD not supported; retry with GET
      if (res.status === 405) {
        res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
      }
    } catch {
      res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' });
    }
    // Consider the portal "up" if the server responded at all — even 4xx (e.g. 403 Forbidden,
    // 401 Unauthorized, 302 redirect-to-login). These all mean the server is reachable.
    // Only treat as "down" on 5xx (server error) or network failure (caught below).
    return res.status < 500 ? 'up' : 'down';
  } catch {
    // Network failure, DNS error, timeout, or connection refused → genuinely down
    return 'down';
  } finally {
    clearTimeout(timeout);
  }
}

/** Mock portal API: GET /api/config returns { success, data: Array<{ portalId, enabled, ... }> }. */
async function fetchMockPortalConfigs(mockBaseUrl: string): Promise<Map<string, boolean>> {
  const base = mockBaseUrl.replace(/\/+$/, '');
  const url = `${base}/api/config`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIVENESS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return new Map();
    const body = (await res.json()) as { success?: boolean; data?: Array<{ portalId?: string; enabled?: boolean }> };
    const list = body?.data && Array.isArray(body.data) ? body.data : [];
    const map = new Map<string, boolean>();
    for (const c of list) {
      if (c && typeof c.portalId === 'string') {
        map.set(c.portalId, c.enabled === true);
      }
    }
    return map;
  } catch {
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

/** Normalize to origin only (scheme + host + port). Mock API is at {origin}/api/config, never under a path. */
function toOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Collect candidate base URLs (origins only) for mock API: default base + origins from per-portal overrides. */
function getMockApiCandidateBases(mockDefaultBase: string, portalUrls: Record<string, string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (mockDefaultBase) {
    const origin = toOrigin(mockDefaultBase);
    if (origin && !seen.has(origin)) {
      seen.add(origin);
      out.push(origin);
    }
  }
  for (const u of Object.values(portalUrls)) {
    if (typeof u !== 'string' || !u.trim()) continue;
    const origin = toOrigin(u);
    if (origin && !seen.has(origin)) {
      seen.add(origin);
      out.push(origin);
    }
  }
  return out;
}

/**
 * Get liveness for all enabled portals of a tenant.
 * - When mock mode is on: asks the mock portal API (/api/config) for each portal's on/off state.
 * - Otherwise: HTTP liveness check against each portal URL.
 * @param logger - Optional; when provided, logs mock liveness resolution for debugging.
 */
export async function getLivenessForTenant(
  tenantId: string,
  options?: { portalIds?: string[]; logger?: FastifyBaseLogger }
): Promise<{ items: LivenessItem[]; checked_at: string }> {
  const db = getDb();
  const portalRepo = new PortalConfigRepository(db);
  const settingsRepo = new SystemSettingsRepository(db);
  const logger = options?.logger;

  const mockEnabled =
    (await settingsRepo.getBoolean(tenantId, 'mock', 'enabled', false)) ||
    (await settingsRepo.getBoolean(null, 'mock', 'enabled', false));
  const portalUrlsRaw =
    (await settingsRepo.getJson<Record<string, unknown>>(tenantId, 'mock', 'portal_urls', {})) ||
    (await settingsRepo.getJson<Record<string, unknown>>(null, 'mock', 'portal_urls', {})) ||
    {};
  const portalUrls: Record<string, string> = {};
  for (const [k, v] of Object.entries(portalUrlsRaw)) {
    const s = normalizeString(v);
    if (s) portalUrls[k] = s;
  }
  const mockDefaultBase = normalizeString(
    (await settingsRepo.getString(tenantId, 'mock', 'default_base_url', '')) ||
    (await settingsRepo.getString(null, 'mock', 'default_base_url', '')) ||
    ''
  );

  const portals = await portalRepo.findByTenantId(tenantId, { enabled: true, limit: 50 });
  const filtered = options?.portalIds?.length
    ? portals.filter((p) => options.portalIds!.includes(p.portal_id))
    : portals;
  const checkedAt = new Date().toISOString();

  if (mockEnabled) {
    const candidateBases = getMockApiCandidateBases(mockDefaultBase, portalUrls);
    if (logger) {
      logger.info(
        { tenantId, mockEnabled, mockDefaultBase: mockDefaultBase || '(empty)', candidateBases, portalUrlKeys: Object.keys(portalUrls) },
        'Liveness: mock mode, resolving via mock portal API'
      );
    }
    let mockConfigs = new Map<string, boolean>();
    let usedBase = '';
    for (const base of candidateBases) {
      mockConfigs = await fetchMockPortalConfigs(base);
      if (mockConfigs.size > 0) {
        usedBase = base;
        break;
      }
    }
    if (logger) {
      logger.info(
        { candidateBases, usedBase: usedBase || '(none)', configCount: mockConfigs.size, configs: Object.fromEntries(mockConfigs) },
        'Liveness: mock API result'
      );
    }
    if (mockConfigs.size > 0) {
      const items: LivenessItem[] = filtered.map((portal) => ({
        portal_id: portal.portal_id,
        name: portal.name,
        status: mockConfigs.get(portal.portal_id) === true ? 'up' : 'down',
        checked_at: checkedAt,
      }));
      return { items, checked_at: checkedAt };
    }
  }

  const items = await Promise.all(
    filtered.map(async (portal) => {
      let url = portal.base_url ?? '';
      if (mockEnabled) {
        if (portalUrls[portal.portal_id]) {
          url = portalUrls[portal.portal_id];
        } else if (mockDefaultBase) {
          const base = mockDefaultBase.replace(/\/+$/, '');
          url = `${base}/${portal.portal_id}`;
        }
      }
      const status = await checkUrl(url);
      return { portal_id: portal.portal_id, name: portal.name, status, checked_at: checkedAt };
    })
  );

  return { items, checked_at: checkedAt };
}
