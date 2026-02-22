import type { BrowserContext, Page } from 'playwright';
import type { PortalConfig } from '../../config/types.js';
import { getBrowser } from './browser-manager.js';
import { ProxyManager } from '../networking/proxy-manager.js';
import { getConfigService } from '../../config/config-service.js';
import { getFingerprintContextOptions } from './fingerprint.js';

export interface JobContext {
  ctx: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export async function createJobContext(args: {
  jobId: string;
  portalConfig: PortalConfig;
  /** From profile: when enabled, apply consistent locale/timezone/userAgent. */
  fingerprint?: { enabled?: boolean };
}): Promise<JobContext> {
  const browser = await getBrowser();
  const browserConfig = getConfigService().get('browser');

  const proxyEp = new ProxyManager(args.portalConfig.proxy).pick();
  const fingerprintOpts = getFingerprintContextOptions(
    args.fingerprint ? { enabled: !!args.fingerprint.enabled } : undefined
  );

  const ctx = await browser.newContext({
    proxy: proxyEp
      ? {
          server: proxyEp.server,
          username: proxyEp.username,
          password: proxyEp.password,
        }
      : undefined,
    acceptDownloads: true,
    viewport: { width: browserConfig.viewport_width, height: browserConfig.viewport_height },
    ...fingerprintOpts,
  });

  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(args.portalConfig.timeouts.navigationMs);
  page.setDefaultTimeout(args.portalConfig.timeouts.actionMs);

  return {
    ctx,
    page,
    async close() {
      await ctx.close();
    },
  };
}