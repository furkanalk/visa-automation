import type { PortalConfig } from './types.js';

export const GLOBAL_DEFAULTS = {
  timeouts: {
    navigationMs: 45_000,
    actionMs: 15_000,
  },
  pacing: {
    minDelayMs: 250,
    maxDelayMs: 900,
    jitter: 0.35,
  },
  rateLimit: {
    enabled: true,
    actionsPerMinute: 30,
    burst: 6,
  },
  proxy: {
    enabled: false,
    strategy: 'off' as const,
    providers: [],
  },
  hitl: {
    otpMode: 'pause' as const,
    captchaMode: 'hitl' as const,
    maxWaitSeconds: 180,
  },
  selectorsVersion: 'v1',
} satisfies Omit<PortalConfig, 'portalId' | 'baseUrl'>;