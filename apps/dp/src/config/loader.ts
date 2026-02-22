import type { PortalConfig, PortalId, DeepPartial } from './types.js';
import type { AgentProfileConfig } from '@visa-automation/shared';
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
 * Convert agent profile config to a portal-shaped partial for merging.
 * Supports both portal-shaped keys (actionsPerMinute, minDelayMs, hitl, etc.) and legacy (rpm, minMs).
 */
function profileToPortalPartial(profile: AgentProfileConfig | null | undefined): Record<string, unknown> {
  if (!profile || typeof profile !== 'object') return {};
  const out: Record<string, unknown> = {};
  const r = profile.rateLimit as Record<string, unknown> | undefined;
  if (r && (r.actionsPerMinute !== undefined || r.burst !== undefined || r.enabled !== undefined || r.rpm !== undefined)) {
    out.rateLimit = {
      ...((out.rateLimit as object) ?? {}),
      ...(r.enabled !== undefined && { enabled: r.enabled }),
      ...(r.actionsPerMinute !== undefined && { actionsPerMinute: r.actionsPerMinute }),
      ...(r.burst !== undefined && { burst: r.burst }),
      ...(r.rpm !== undefined && r.actionsPerMinute === undefined && { actionsPerMinute: r.rpm }),
    };
  }
  const p = profile.pacing as Record<string, unknown> | undefined;
  if (p && (p.minDelayMs !== undefined || p.maxDelayMs !== undefined || p.jitter !== undefined || p.minMs !== undefined || p.maxMs !== undefined)) {
    const pacing: Record<string, unknown> = { ...((out.pacing as object) ?? {}) };
    if (p.minDelayMs !== undefined) pacing.minDelayMs = p.minDelayMs;
    else if (p.minMs !== undefined) pacing.minDelayMs = p.minMs;
    if (p.maxDelayMs !== undefined) pacing.maxDelayMs = p.maxDelayMs;
    else if (p.maxMs !== undefined) pacing.maxDelayMs = p.maxMs;
    if (p.jitter !== undefined) pacing.jitter = p.jitter;
    out.pacing = pacing;
  }
  const t = profile.timeouts as { navigationMs?: number; actionMs?: number } | undefined;
  if (t?.navigationMs !== undefined || t?.actionMs !== undefined) {
    const timeouts: Record<string, unknown> = { ...((out.timeouts as object) ?? {}) };
    if (t.navigationMs !== undefined) timeouts.navigationMs = t.navigationMs;
    if (t.actionMs !== undefined) timeouts.actionMs = t.actionMs;
    out.timeouts = timeouts;
  }
  const h = profile.hitl as Record<string, unknown> | undefined;
  if (h && (h.otpMode !== undefined || h.captchaMode !== undefined || h.maxWaitSeconds !== undefined)) {
    out.hitl = { ...((out.hitl as object) ?? {}), ...h };
  }
  if (profile.minRunDurationMs !== undefined) out.minRunDurationMs = profile.minRunDurationMs;
  if (profile.mouseMoveIntervalMs !== undefined) out.mouseMoveIntervalMs = profile.mouseMoveIntervalMs;
  return out;
}

/**
 * Resolve portal config from CP (Postgres) only. No file defaults – CP must provide full config.
 * Merge order: profile and portal are merged according to config_priority; then jobOverride on top.
 */
export function resolvePortalConfig(args: {
  portalId: PortalId;
  /** Full portal config from CP (Admin Portals). Must include base_url and all config keys. */
  primaryFromCP: DeepPartial<PortalConfig>;
  /** Agent profile config (optional). Overlapping keys merged per config_priority. */
  profileConfig?: AgentProfileConfig | null;
  /** When both profile and portal have a key: profile_over_portal = profile wins; portal_over_profile = portal wins. Default: portal_over_profile. */
  configPriority?: 'profile_over_portal' | 'portal_over_profile';
  jobOverride?: DeepPartial<PortalConfig>;
}): PortalConfig {
  if (!args.primaryFromCP?.baseUrl) {
    throw new Error(
      `Portal ${args.portalId} not configured in CP or missing base_url. Add/configure the portal in Admin → Portals.`
    );
  }

  const priority = args.configPriority ?? 'portal_over_profile';
  const profilePartial = profileToPortalPartial(args.profileConfig);

  const merged =
    priority === 'profile_over_portal'
      ? (deepMerge(
          args.primaryFromCP as Record<string, unknown>,
          profilePartial,
          (args.jobOverride ?? {}) as Record<string, unknown>
        ) as Record<string, unknown>)
      : (deepMerge(
          profilePartial,
          args.primaryFromCP as Record<string, unknown>,
          (args.jobOverride ?? {}) as Record<string, unknown>
        ) as Record<string, unknown>);

  assertFullPortalConfig(args.portalId, merged);

  const slotHuntFromMerge = merged.slotHunt as { maxPolls?: number; pollDelayMinMs?: number; pollDelayMaxMs?: number } | undefined;
  const slotHunt = {
    maxPolls: slotHuntFromMerge?.maxPolls ?? 12,
    pollDelayMinMs: slotHuntFromMerge?.pollDelayMinMs ?? 1500,
    pollDelayMaxMs: slotHuntFromMerge?.pollDelayMaxMs ?? 3000,
  };

  return {
    portalId: args.portalId,
    ...merged,
    baseUrl: getPortalBaseUrl(args.portalId, merged.baseUrl as string),
    slotHunt,
  } as PortalConfig;
}
