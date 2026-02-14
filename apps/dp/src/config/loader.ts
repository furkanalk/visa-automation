import type { PortalConfig, PortalId, DeepPartial } from './types.js';
import { deepMerge } from './merge.js';

/**
 * Mock: when USE_MOCK_PORTAL=true, base URL is overridden (e.g. test).
 */
const MOCK_PORTAL_URLS: Record<PortalId, string> = {
  'as-visa': 'http://localhost:3004/as-visa',
};

function shouldUseMockPortal(): boolean {
  return process.env.USE_MOCK_PORTAL === 'true' || process.env.USE_MOCK_PORTAL === '1';
}

function getPortalBaseUrl(portalId: PortalId, configBaseUrl: string): string {
  if (shouldUseMockPortal()) {
    const mockUrl = process.env.MOCK_PORTAL_URL || MOCK_PORTAL_URLS[portalId];
    if (mockUrl) return mockUrl;
  }
  return configBaseUrl;
}

/**
 * Validate that merged object has all required portal config fields (from Postgres/CP).
 * Throws with a clear message if any required field is missing.
 */
function assertFullPortalConfig(portalId: PortalId, m: Record<string, unknown>): void {
  const missing: string[] = [];
  if (!m.baseUrl || typeof m.baseUrl !== 'string') missing.push('baseUrl');
  if (!m.timeouts || typeof (m.timeouts as any).navigationMs !== 'number') missing.push('timeouts.navigationMs');
  if (!m.timeouts || typeof (m.timeouts as any).actionMs !== 'number') missing.push('timeouts.actionMs');
  if (!m.pacing || typeof (m.pacing as any).minDelayMs !== 'number') missing.push('pacing.minDelayMs');
  if (!m.pacing || typeof (m.pacing as any).maxDelayMs !== 'number') missing.push('pacing.maxDelayMs');
  if (!m.pacing || typeof (m.pacing as any).jitter !== 'number') missing.push('pacing.jitter');
  if (!m.rateLimit || typeof (m.rateLimit as any).enabled !== 'boolean') missing.push('rateLimit.enabled');
  if (!m.rateLimit || typeof (m.rateLimit as any).actionsPerMinute !== 'number') missing.push('rateLimit.actionsPerMinute');
  if (!m.rateLimit || typeof (m.rateLimit as any).burst !== 'number') missing.push('rateLimit.burst');
  if (!m.proxy || typeof (m.proxy as any).enabled !== 'boolean') missing.push('proxy.enabled');
  if (!m.proxy || typeof (m.proxy as any).strategy !== 'string') missing.push('proxy.strategy');
  if (!m.proxy || !Array.isArray((m.proxy as any).providers)) missing.push('proxy.providers');
  if (!m.hitl || typeof (m.hitl as any).otpMode !== 'string') missing.push('hitl.otpMode');
  if (!m.hitl || typeof (m.hitl as any).captchaMode !== 'string') missing.push('hitl.captchaMode');
  if (!m.hitl || typeof (m.hitl as any).maxWaitSeconds !== 'number') missing.push('hitl.maxWaitSeconds');
  if (typeof m.selectorsVersion !== 'string') missing.push('selectorsVersion');
  if (missing.length > 0) {
    throw new Error(
      `Portal ${portalId} config from CP is incomplete. Missing or invalid: ${missing.join(', ')}. ` +
        'Ensure Admin → Portals has full config (bootstrap/migrations load defaults).'
    );
  }
}

/**
 * Resolve portal config from CP (Postgres) only. No file defaults – CP must provide full config.
 * Merge order: primaryFromCP < jobOverride. All required fields must be present (from bootstrap/migrations or Admin).
 */
export function resolvePortalConfig(args: {
  portalId: PortalId;
  /** Full portal config from CP (Admin Portals). Must include base_url and all config keys. */
  primaryFromCP: DeepPartial<PortalConfig>;
  jobOverride?: DeepPartial<PortalConfig>;
}): PortalConfig {
  if (!args.primaryFromCP?.baseUrl) {
    throw new Error(
      `Portal ${args.portalId} not configured in CP or missing base_url. Add/configure the portal in Admin → Portals.`
    );
  }

  const merged = deepMerge(
    args.primaryFromCP as Record<string, unknown>,
    (args.jobOverride ?? {}) as Record<string, unknown>
  ) as Record<string, unknown>;

  assertFullPortalConfig(args.portalId, merged);

  return {
    portalId: args.portalId,
    ...merged,
    baseUrl: getPortalBaseUrl(args.portalId, merged.baseUrl as string),
  } as PortalConfig;
}
