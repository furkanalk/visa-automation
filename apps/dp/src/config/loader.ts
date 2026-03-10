import type { PortalConfig, PortalId, DeepPartial } from './types.js';
import type { AgentProfileConfig } from '@visa-automation/shared';
import { deepMerge } from './merge.js';
import { getConfigService } from './config-service.js';

/**
 * Mock: base URL is overridden only when mock.enabled=true (DB via CP).
 *
 * MOCK_PORTAL_BASE_URL (env) — base host only, no path, no trailing slash.
 *   e.g. http://mock-portal:3004
 *   Each portal gets:  base + "/" + portalId  →  http://mock-portal:3004/as-visa
 *   Adding a new portal (e.g. "example-site") needs no env change — it just works.
 *
 * Legacy MOCK_PORTAL_URL still accepted (full URL including path) for backwards compat.
 * If set, it applies to ALL portals (use only when there is a single portal).
 */
const MOCK_PORTAL_BASE_URL_FALLBACK = 'http://localhost:3004';

// function shouldUseMockPortal(): boolean {
//   // Env var hard-override (always wins)
//   if (process.env.USE_MOCK_PORTAL === 'true' || process.env.USE_MOCK_PORTAL === '1') return true;
//   // DB setting via ConfigService (dynamic, refreshed periodically from CP)
//   try {
//     const cfg = getConfigService();
//     return cfg.get('mock').enabled === true;
//   } catch {
//     // ConfigService not yet initialized — fall back to false
//     return false;
//   }
// }
function shouldUseMockPortal(): boolean {
  try {
      const cfg = getConfigService();
      return cfg.get('mock').enabled === true;
    } 
   catch {
     return false;
  }
}

function getMockBaseUrl(portalId: PortalId): string {
  // Env explicit override
  if (process.env.MOCK_PORTAL_URL) return process.env.MOCK_PORTAL_URL;
  // Try DB value first, then env, then fallback
  let base: string | undefined;
  try {
    const dbUrl = getConfigService().get('mock').default_base_url;
    if (dbUrl) base = dbUrl;
  } catch { /* not initialized yet */ }
  base = base || process.env.MOCK_PORTAL_BASE_URL || MOCK_PORTAL_BASE_URL_FALLBACK;
  return `${base.replace(/\/$/, '')}/${portalId}`;
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
  // Mouse waypoint/jitter/speed params (same keys as PortalConfig)
  if (profile.mouseMoveSegmentsMin !== undefined) out.mouseMoveSegmentsMin = profile.mouseMoveSegmentsMin;
  if (profile.mouseMoveSegmentsMax !== undefined) out.mouseMoveSegmentsMax = profile.mouseMoveSegmentsMax;
  if (profile.mouseMoveJitterPx !== undefined) out.mouseMoveJitterPx = profile.mouseMoveJitterPx;
  if (profile.mouseMoveStepsMin !== undefined) out.mouseMoveStepsMin = profile.mouseMoveStepsMin;
  if (profile.mouseMoveStepsMax !== undefined) out.mouseMoveStepsMax = profile.mouseMoveStepsMax;
  if (profile.mouseMoveDelayMinMs !== undefined) out.mouseMoveDelayMinMs = profile.mouseMoveDelayMinMs;
  if (profile.mouseMoveDelayMaxMs !== undefined) out.mouseMoveDelayMaxMs = profile.mouseMoveDelayMaxMs;
  // slotHunt: map profile key names (sleepMinMs/Max) → portal key names (pollDelayMinMs/Max)
  const sh = profile.slotHunt as { maxPolls?: number; sleepMinMs?: number; sleepMaxMs?: number } | undefined;
  if (sh && (sh.maxPolls !== undefined || sh.sleepMinMs !== undefined || sh.sleepMaxMs !== undefined)) {
    out.slotHunt = {
      ...(sh.maxPolls !== undefined && { maxPolls: sh.maxPolls }),
      ...(sh.sleepMinMs !== undefined && { pollDelayMinMs: sh.sleepMinMs }),
      ...(sh.sleepMaxMs !== undefined && { pollDelayMaxMs: sh.sleepMaxMs }),
    };
  }
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

  const slotHuntFromMerge = merged.slotHunt as { maxPolls?: number; pollDelayMinMs?: number; pollDelayMaxMs?: number; maxReadyWaits?: number } | undefined;
  const slotHunt = {
    maxPolls: slotHuntFromMerge?.maxPolls ?? 12,
    pollDelayMinMs: slotHuntFromMerge?.pollDelayMinMs ?? 1500,
    pollDelayMaxMs: slotHuntFromMerge?.pollDelayMaxMs ?? 3000,
    ...(slotHuntFromMerge?.maxReadyWaits != null && { maxReadyWaits: slotHuntFromMerge.maxReadyWaits }),
  };

  return {
    portalId: args.portalId,
    ...merged,
    baseUrl: shouldUseMockPortal() ? getMockBaseUrl(args.portalId) : (merged.baseUrl as string),
    slotHunt,
  } as PortalConfig;
}
