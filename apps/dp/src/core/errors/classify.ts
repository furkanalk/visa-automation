/**
 * Classify errors as hard (no auto-retry) vs soft (retry allowed).
 * Used to set FAILED_TERMINAL vs FAILED_RETRYABLE.
 */
export type ErrorKind = 'hard' | 'soft';

const HARD_PATTERNS = [
  /validation/i,
  /invalid.*(credentials|auth|login|password)/i,
  /unauthorized/i,
  /forbidden/i,
  /\b400\b|\b401\b|\b403\b|\b404\b/i, // 4xx except 429
  /ECONNREFUSED/i,
  /certificate/i,
  /schema/i,
];

const SOFT_PATTERNS = [
  /timeout/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /ENETUNREACH/i,
  /ECONNRESET/i,
  /socket hang up/i,
  /429/i,
  /too many requests/i,
  /rate limit/i,
  /temporarily unavailable/i,
];

export function classifyError(err: unknown): ErrorKind {
  const message = err instanceof Error ? err.message : String(err);
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : '';

  const str = `${message} ${code}`.toLowerCase();
  for (const p of HARD_PATTERNS) {
    if (p.test(str)) return 'hard';
  }
  for (const p of SOFT_PATTERNS) {
    if (p.test(str)) return 'soft';
  }
  // Default: treat unknown as soft so we retry (safer for transient issues)
  return 'soft';
}
