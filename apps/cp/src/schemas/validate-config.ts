/**
 * Server-side validation for portal_config and profile config (API write path).
 * Config source of truth is Postgres; these validate shape before persist.
 * Merge order: defaults(code) < system_settings < profile < portal_config < job.config.
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
  if (c.selectorsVersion !== undefined) checkString(c.selectorsVersion, 'config.selectorsVersion');
}

/** Validate selectors JSON (must be object if present). */
export function validatePortalSelectors(selectors: unknown): void {
  if (selectors !== undefined && selectors !== null && !isPlainObject(selectors)) {
    throw new Error('portal selectors must be an object');
  }
}

/** Validate profile config JSON (partial allowed; same shape as portal for merged keys). */
export function validateProfileConfig(config: unknown): void {
  if (!config || !isPlainObject(config)) {
    throw new Error('profile config is required and must be an object');
  }
  const c = config as Record<string, unknown>;

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
  checkString(c.portalId, 'config.portalId');
}
