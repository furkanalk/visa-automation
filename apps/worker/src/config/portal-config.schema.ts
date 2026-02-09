import type { PortalConfig } from './types.js';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`portal config invalid: ${msg}`);
}

export function validatePortalConfig(x: any): PortalConfig {
  assert(x && typeof x === 'object', 'root must be object');

  assert(typeof x.portalId === 'string', 'portalId must be string');
  assert(typeof x.baseUrl === 'string', 'baseUrl must be string');

  assert(x.timeouts && typeof x.timeouts === 'object', 'timeouts must be object');
  assert(typeof x.timeouts.navigationMs === 'number', 'timeouts.navigationMs must be number');
  assert(typeof x.timeouts.actionMs === 'number', 'timeouts.actionMs must be number');

  assert(x.pacing && typeof x.pacing === 'object', 'pacing must be object');
  assert(typeof x.pacing.minDelayMs === 'number', 'pacing.minDelayMs must be number');
  assert(typeof x.pacing.maxDelayMs === 'number', 'pacing.maxDelayMs must be number');
  assert(typeof x.pacing.jitter === 'number', 'pacing.jitter must be number');

  assert(x.rateLimit && typeof x.rateLimit === 'object', 'rateLimit must be object');
  assert(typeof x.rateLimit.enabled === 'boolean', 'rateLimit.enabled must be boolean');
  assert(typeof x.rateLimit.actionsPerMinute === 'number', 'rateLimit.actionsPerMinute must be number');
  assert(typeof x.rateLimit.burst === 'number', 'rateLimit.burst must be number');

  assert(x.proxy && typeof x.proxy === 'object', 'proxy must be object');
  assert(typeof x.proxy.enabled === 'boolean', 'proxy.enabled must be boolean');
  assert(typeof x.proxy.strategy === 'string', 'proxy.strategy must be string');
  assert(Array.isArray(x.proxy.providers), 'proxy.providers must be array');

  assert(x.hitl && typeof x.hitl === 'object', 'hitl must be object');
  assert(typeof x.hitl.otpMode === 'string', 'hitl.otpMode must be string');
  assert(typeof x.hitl.captchaMode === 'string', 'hitl.captchaMode must be string');
  assert(typeof x.hitl.maxWaitSeconds === 'number', 'hitl.maxWaitSeconds must be number');

  assert(typeof x.selectorsVersion === 'string', 'selectorsVersion must be string');

  return x as PortalConfig;
}
