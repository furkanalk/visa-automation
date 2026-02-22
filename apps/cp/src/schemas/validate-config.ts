/**
 * Server-side validation for portal_config, profile config, and job config (API write path).
 * Config source of truth is Postgres; these validate shape before persist.
 * Merge order: defaults(code) < system_settings < profile < portal_config < job.config.
 * - validatePortalConfig: used by portals API and by validateJobConfig for config.portal
 * - validateProfileConfig: used by profiles API
 * - validateJobConfig: used by job.service createJob (slot_check_only + optional portal override)
 */

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
}

function checkNumber(x: unknown, path: string): void {
  if (x !== undefined && typeof x !== 'number') {
    throw new Error(`${path} must be a number`);
  }
}

function checkBoolean(x: unknown, path: string): void {
  if (x !== undefined && typeof x !== 'boolean') {
    throw new Error(`${path} must be a boolean`);
  }
}

function checkString(x: unknown, path: string): void {
  if (x !== undefined && typeof x !== 'string') {
    throw new Error(`${path} must be a string`);
  }
}

/** Validate portal config JSON (partial allowed; known keys type-checked). */
export function validatePortalConfig(config: unknown): void {
  if (config !== undefined && config !== null && !isPlainObject(config)) {
    throw new Error('portal config must be an object');
  }
  if (!config) return;
  const c = config as Record<string, unknown>;

  if (c.timeouts !== undefined) {
    if (!isPlainObject(c.timeouts)) throw new Error('portal config.timeouts must be an object');
    const t = c.timeouts as Record<string, unknown>;
    checkNumber(t.navigationMs, 'config.timeouts.navigationMs');
    checkNumber(t.actionMs, 'config.timeouts.actionMs');
  }
  if (c.pacing !== undefined) {
    if (!isPlainObject(c.pacing)) throw new Error('portal config.pacing must be an object');
    const p = c.pacing as Record<string, unknown>;
    checkNumber(p.minDelayMs, 'config.pacing.minDelayMs');
    checkNumber(p.maxDelayMs, 'config.pacing.maxDelayMs');
    checkNumber(p.jitter, 'config.pacing.jitter');
  }
  if (c.rateLimit !== undefined) {
    if (!isPlainObject(c.rateLimit)) throw new Error('portal config.rateLimit must be an object');
    const r = c.rateLimit as Record<string, unknown>;
    checkBoolean(r.enabled, 'config.rateLimit.enabled');
    checkNumber(r.actionsPerMinute, 'config.rateLimit.actionsPerMinute');
    checkNumber(r.burst, 'config.rateLimit.burst');
  }
  if (c.proxy !== undefined) {
    if (!isPlainObject(c.proxy)) throw new Error('portal config.proxy must be an object');
    const px = c.proxy as Record<string, unknown>;
    checkBoolean(px.enabled, 'config.proxy.enabled');
    checkString(px.strategy, 'config.proxy.strategy');
    if (px.providers !== undefined && !Array.isArray(px.providers)) {
      throw new Error('portal config.proxy.providers must be an array');
    }
  }
  if (c.hitl !== undefined) {
    if (!isPlainObject(c.hitl)) throw new Error('portal config.hitl must be an object');
    const h = c.hitl as Record<string, unknown>;
    checkString(h.otpMode, 'config.hitl.otpMode');
    checkString(h.captchaMode, 'config.hitl.captchaMode');
    checkNumber(h.maxWaitSeconds, 'config.hitl.maxWaitSeconds');
  }
  if (c.slotHunt !== undefined) {
    if (!isPlainObject(c.slotHunt)) throw new Error('portal config.slotHunt must be an object');
    const s = c.slotHunt as Record<string, unknown>;
    checkNumber(s.maxPolls, 'config.slotHunt.maxPolls');
    checkNumber(s.pollDelayMinMs, 'config.slotHunt.pollDelayMinMs');
    checkNumber(s.pollDelayMaxMs, 'config.slotHunt.pollDelayMaxMs');
  }
  if (c.selectorsVersion !== undefined) checkString(c.selectorsVersion, 'config.selectorsVersion');
  if (c.minRunDurationMs !== undefined) checkNumber(c.minRunDurationMs, 'config.minRunDurationMs');
  if (c.mouseMoveIntervalMs !== undefined) checkNumber(c.mouseMoveIntervalMs, 'config.mouseMoveIntervalMs');
  if (c.mouseMoveSegmentsMin !== undefined) checkNumber(c.mouseMoveSegmentsMin, 'config.mouseMoveSegmentsMin');
  if (c.mouseMoveSegmentsMax !== undefined) checkNumber(c.mouseMoveSegmentsMax, 'config.mouseMoveSegmentsMax');
  if (c.mouseMoveJitterPx !== undefined) checkNumber(c.mouseMoveJitterPx, 'config.mouseMoveJitterPx');
  if (c.mouseMoveStepsMin !== undefined) checkNumber(c.mouseMoveStepsMin, 'config.mouseMoveStepsMin');
  if (c.mouseMoveStepsMax !== undefined) checkNumber(c.mouseMoveStepsMax, 'config.mouseMoveStepsMax');
  if (c.mouseMoveDelayMinMs !== undefined) checkNumber(c.mouseMoveDelayMinMs, 'config.mouseMoveDelayMinMs');
  if (c.mouseMoveDelayMaxMs !== undefined) checkNumber(c.mouseMoveDelayMaxMs, 'config.mouseMoveDelayMaxMs');
}

/** Validate selectors JSON (must be object if present). */
export function validatePortalSelectors(selectors: unknown): void {
  if (selectors !== undefined && selectors !== null && !isPlainObject(selectors)) {
    throw new Error('portal selectors must be an object');
  }
}

const CONFIG_PRIORITY_VALUES = ['profile_over_portal', 'portal_over_profile'] as const;

/** Validate profile config JSON (partial allowed; same shape as portal for merged keys). */
export function validateProfileConfig(config: unknown): void {
  if (!config || !isPlainObject(config)) {
    throw new Error('profile config is required and must be an object');
  }
  const c = config as Record<string, unknown>;

  if (c.config_priority !== undefined) {
    if (typeof c.config_priority !== 'string' || !CONFIG_PRIORITY_VALUES.includes(c.config_priority as any)) {
      throw new Error('profile config.config_priority must be "profile_over_portal" or "portal_over_profile"');
    }
  }

  if (c.timeouts !== undefined) {
    if (!isPlainObject(c.timeouts)) throw new Error('profile config.timeouts must be an object');
    const t = c.timeouts as Record<string, unknown>;
    checkNumber(t.navigationMs, 'config.timeouts.navigationMs');
    checkNumber(t.actionMs, 'config.timeouts.actionMs');
  }
  if (c.pacing !== undefined) {
    if (!isPlainObject(c.pacing)) throw new Error('profile config.pacing must be an object');
    const p = c.pacing as Record<string, unknown>;
    checkNumber(p.minDelayMs, 'config.pacing.minDelayMs');
    checkNumber(p.maxDelayMs, 'config.pacing.maxDelayMs');
    checkNumber(p.jitter, 'config.pacing.jitter');
  }
  if (c.rateLimit !== undefined) {
    if (!isPlainObject(c.rateLimit)) throw new Error('profile config.rateLimit must be an object');
    const r = c.rateLimit as Record<string, unknown>;
    checkBoolean(r.enabled, 'config.rateLimit.enabled');
    checkNumber(r.actionsPerMinute, 'config.rateLimit.actionsPerMinute');
    checkNumber(r.burst, 'config.rateLimit.burst');
  }
  if (c.hitl !== undefined) {
    if (!isPlainObject(c.hitl)) throw new Error('profile config.hitl must be an object');
    const h = c.hitl as Record<string, unknown>;
    checkString(h.otpMode, 'config.hitl.otpMode');
    checkString(h.captchaMode, 'config.hitl.captchaMode');
    checkNumber(h.maxWaitSeconds, 'config.hitl.maxWaitSeconds');
  }
  if (c.slotHunt !== undefined) {
    if (!isPlainObject(c.slotHunt)) throw new Error('profile config.slotHunt must be an object');
    const s = c.slotHunt as Record<string, unknown>;
    checkNumber(s.maxPolls, 'config.slotHunt.maxPolls');
    checkNumber(s.pollDelayMinMs, 'config.slotHunt.pollDelayMinMs');
    checkNumber(s.pollDelayMaxMs, 'config.slotHunt.pollDelayMaxMs');
  }
  if (c.retry !== undefined) {
    if (!isPlainObject(c.retry)) throw new Error('profile config.retry must be an object');
    const r = c.retry as Record<string, unknown>;
    checkNumber(r.maxAttempts, 'config.retry.maxAttempts');
    checkNumber(r.delayMs, 'config.retry.delayMs');
    checkNumber(r.backoffMultiplier, 'config.retry.backoffMultiplier');
  }
  if (c.is_scout !== undefined) checkBoolean(c.is_scout, 'config.is_scout');
  if (c.slot_check_only !== undefined) checkBoolean(c.slot_check_only, 'config.slot_check_only');
  if (c.minRunDurationMs !== undefined) checkNumber(c.minRunDurationMs, 'config.minRunDurationMs');
  if (c.mouseMoveIntervalMs !== undefined) checkNumber(c.mouseMoveIntervalMs, 'config.mouseMoveIntervalMs');
}

/**
 * Validate job config (create-job API). Allows slot_check_only and optional portal override.
 * If config.portal is present, it must match portal config shape (partial allowed).
 */
export function validateJobConfig(config: unknown): void {
  if (config === undefined || config === null) return;
  if (!isPlainObject(config)) {
    throw new Error('job config must be an object');
  }
  const c = config as Record<string, unknown>;
  if (c.slot_check_only !== undefined) checkBoolean(c.slot_check_only, 'config.slot_check_only');
  if (c.portal !== undefined) {
    if (!isPlainObject(c.portal)) throw new Error('job config.portal must be an object');
    validatePortalConfig(c.portal);
  }
}
