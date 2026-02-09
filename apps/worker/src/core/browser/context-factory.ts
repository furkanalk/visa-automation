import type { BrowserContext, Page } from 'playwright';
import type { PortalConfig } from '../../config/types.js';
import { getBrowser } from './browser-manager.js';
import { ProxyManager } from '../networking/proxy-manager.js';

export interface JobContext {
  ctx: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

export async function createJobContext(args: {
  jobId: string;
  portalConfig: PortalConfig;
}): Promise<JobContext> {
  const browser = await getBrowser();

  const proxyEp = new ProxyManager(args.portalConfig.proxy).pick();

  const ctx = await browser.newContext({
    proxy: proxyEp
      ? {
          server: proxyEp.server,
          username: proxyEp.username,
          password: proxyEp.password,
        }
      : undefined,
    acceptDownloads: true,
    viewport: { width: 1366, height: 768 },
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