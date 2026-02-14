import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { isBrowserLaunched } from '../browser/browser-manager.js';
import { metrics } from './metrics.js';
import { getJobQueue } from '../queue/queue.js';

export interface HealthServerOptions {
  /** Returns true if CP is reachable */
  cpHealthCheck: () => Promise<boolean>;
}

export function startHealthServer(
  port: number,
  options: HealthServerOptions
): { server: ReturnType<typeof createServer>; close: () => Promise<void> } {
  const { cpHealthCheck } = options;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    const path = url.split('?')[0];

    if (path === '/health' && req.method === 'GET') {
      const cp_connected = await cpHealthCheck();
      const browser_ok = isBrowserLaunched();
      // Notify is configured per-tenant in CP; if CP is reachable, consider it available
      const notify_ok = cp_connected;
      const healthy = cp_connected && browser_ok;

      res.writeHead(healthy ? 200 : 503, {
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          status: healthy ? 'healthy' : 'unhealthy',
          service: 'dp',
          checks: {
            cp_connected,
            browser_ok,
            notify_configured: notify_ok,
          },
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    if (path === '/metrics' && req.method === 'GET') {
      try {
        const queue = getJobQueue();
        const counts = await queue.getJobCounts();
        const waiting = counts.waiting ?? 0;
        const active = counts.active ?? 0;
        const delayed = counts.delayed ?? 0;
        metrics.gauge('dp_queue_depth').set(waiting + active + delayed);
      } catch {
        metrics.gauge('dp_queue_depth').set(-1);
      }

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end(metrics.prometheusText());
      return;
    }

    if (path === '/live' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'dp' }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    console.info(`DP health server listening on port ${port}`);
  });

  return {
    server,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
