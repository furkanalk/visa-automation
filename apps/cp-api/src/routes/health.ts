import type { FastifyPluginAsync } from 'fastify';
import { getDb } from '@visa-automation/db';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Liveness probe - is the process running?
   * GET /cp/health/live
   */
  app.get('/live', async () => {
    return {
      success: true,
      data: {
        status: 'ok',
        service: 'cp-api',
        timestamp: new Date().toISOString(),
      },
    };
  });

  /**
   * Readiness probe - is the service ready to handle requests?
   * GET /cp/health/ready
   */
  app.get('/ready', async (_request, reply) => {
    const checks: Record<string, { status: string; latency_ms?: number; error?: string }> = {};
    let allHealthy = true;

    // Check database
    const dbStart = Date.now();
    try {
      const db = getDb();
      await db.selectFrom('tenants').select('id').limit(1).execute();
      checks.database = {
        status: 'healthy',
        latency_ms: Date.now() - dbStart,
      };
    } catch (err) {
      checks.database = {
        status: 'unhealthy',
        latency_ms: Date.now() - dbStart,
        error: (err as Error).message,
      };
      allHealthy = false;
    }

    const statusCode = allHealthy ? 200 : 503;
    
    return reply.status(statusCode).send({
      success: allHealthy,
      data: {
        status: allHealthy ? 'ready' : 'not_ready',
        checks,
        timestamp: new Date().toISOString(),
      },
    });
  });

  /**
   * Detailed health check
   * GET /cp/health
   */
  app.get('/', async () => {
    const checks: Record<string, { status: string; latency_ms?: number; details?: unknown }> = {};
    let overallStatus = 'healthy';

    // Check database with more details
    const dbStart = Date.now();
    try {
      const db = getDb();
      const tenants = await db.selectFrom('tenants').select('id').execute();
      
      checks.database = {
        status: 'healthy',
        latency_ms: Date.now() - dbStart,
        details: {
          tenant_count: tenants.length,
        },
      };
    } catch (err) {
      checks.database = {
        status: 'unhealthy',
        latency_ms: Date.now() - dbStart,
        details: { error: (err as Error).message },
      };
      overallStatus = 'unhealthy';
    }

    // Memory usage
    const memUsage = process.memoryUsage();
    checks.memory = {
      status: 'healthy',
      details: {
        heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss_mb: Math.round(memUsage.rss / 1024 / 1024),
      },
    };

    // Uptime
    checks.process = {
      status: 'healthy',
      details: {
        uptime_seconds: Math.round(process.uptime()),
        pid: process.pid,
        node_version: process.version,
      },
    };

    return {
      success: overallStatus === 'healthy',
      data: {
        status: overallStatus,
        service: 'cp-api',
        version: process.env.APP_VERSION ?? '1.0.0',
        environment: process.env.NODE_ENV ?? 'development',
        checks,
        timestamp: new Date().toISOString(),
      },
    };
  });
};
