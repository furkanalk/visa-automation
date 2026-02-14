import type { PortalId } from '../config/types.js';
import type { PortalDriver } from './types.js';
import type { JobState } from '@visa-automation/shared';
import type { StateHandler } from '../core/fsm/runner.js';

// Re-export so consumers can use a single import from registry
export type { PortalDriver } from './types.js';

const drivers = new Map<PortalId, PortalDriver>();
const fsmHandlers = new Map<PortalId, Partial<Record<JobState, StateHandler>>>();

export function registerPortal(driver: PortalDriver): void {
  if (drivers.has(driver.portalId)) {
    throw new Error(`Portal already registered: ${driver.portalId}`);
  }
  drivers.set(driver.portalId, driver);
}

export function getPortal(portalId: PortalId): PortalDriver {
  const d = drivers.get(portalId);
  if (!d) throw new Error(`Portal not registered: ${portalId}`);
  return d;
}

/**
 * Register FSM state handlers for a portal (plugin-scoped).
 * Each portal plugin should call this in its index when loading.
 */
export function registerFSMHandlers(
  portalId: PortalId,
  handlers: Partial<Record<JobState, StateHandler>>
): void {
  const existing = fsmHandlers.get(portalId);
  if (existing) {
    Object.assign(existing, handlers);
  } else {
    fsmHandlers.set(portalId, { ...handlers });
  }
}

/**
 * Get FSM handlers for a portal. Returns empty object if none registered.
 */
export function getFSMHandlers(portalId: PortalId): Partial<Record<JobState, StateHandler>> {
  return fsmHandlers.get(portalId) ?? {};
}

/**
 * List registered portal IDs (for introspection / health).
 */
export function listPortalIds(): PortalId[] {
  return Array.from(drivers.keys());
}
