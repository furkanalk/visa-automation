/**
 * Browser fingerprint options for consistent context when profile has fingerprint.enabled.
 * Applied in createJobContext so the same profile gets stable locale, timezone, and user agent.
 */
export interface FingerprintConfig {
  enabled: boolean;
}

/** Default context options when fingerprinting is enabled (consistent per-run, not random). */
const FINGERPRINT_CONTEXT = {
  locale: 'en-US',
  timezoneId: 'Europe/Istanbul',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
} as const;

export function getFingerprintContextOptions(fingerprint: FingerprintConfig | undefined): Record<string, unknown> {
  if (!fingerprint?.enabled) return {};
  return { ...FINGERPRINT_CONTEXT };
}
