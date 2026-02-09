import fs from 'node:fs';
import path from 'node:path';
import type { PortalConfig, PortalId, DeepPartial } from './types.js';
import { deepMerge } from './merge.js';
import { GLOBAL_DEFAULTS } from './defaults.js';
import { fileURLToPath } from 'node:url';
import { validatePortalConfig } from './portal-config.schema.js';

function portalsDir(): string {
  // 1) override: docker/helm'de mount edebilmek için
  if (process.env.PORTAL_CONFIG_DIR) {
    return process.env.PORTAL_CONFIG_DIR;
  }

  // 2) default: dist içinde config/portals kopyalanmış varsayımı
  // apps/worker/dist/config/loader.js -> apps/worker/dist/config/portals
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, 'portals');
}

export function loadPortalDefaults(portalId: PortalId): PortalConfig {
  const p = path.join(portalsDir(), `${portalId}.json`);
  const raw = fs.readFileSync(p, 'utf-8');
  const parsed = validatePortalConfig(JSON.parse(raw));

  if (parsed.portalId !== portalId) {
    throw new Error(`portal config mismatch: expected ${portalId}, got ${parsed.portalId}`);
  }
  return parsed;
}

/**
 * effective config = global defaults + portal defaults + tenant overrides + job overrides
 */
export function resolvePortalConfig(args: {
  portalId: PortalId;
  tenantOverride?: DeepPartial<PortalConfig>;
  jobOverride?: DeepPartial<PortalConfig>;
}): PortalConfig {
  const portalDefaults = loadPortalDefaults(args.portalId);

  const base: PortalConfig = {
    portalId: portalDefaults.portalId,
    baseUrl: portalDefaults.baseUrl,
    ...deepMerge(GLOBAL_DEFAULTS as any, portalDefaults as any, args.tenantOverride as any, args.jobOverride as any),
  };

  return base;
}
