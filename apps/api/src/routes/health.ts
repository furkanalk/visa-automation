import type { FastifyPluginAsync } from 'fastify';
import { db } from '@visa-automation/db';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Liveness probe - is the process alive?
   */
  app.get('/live', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  /**
   * Readiness probe - is the service ready to accept traffic?
   */
  app.get('/ready', async (request, reply) => {
    const checks: Record<string, boolean> = {};

    // Check database connection
    try {
      await db.instance.selectFrom('tenants').select('id').limit(1).execute();
      checks.database = true;
    } catch (err) {
      checks.database = false;
      request.log.error({ err }, 'Database health check failed');
    }

    // Check Redis connection (via BullMQ queue)
    try {
      const { getQueue } = await import('../queue/producer.js');
      const queue = getQueue();
      // Proper Redis health check with timeout: wait for client and PING
      const redisClient = await queue.client;
      
      // Race PING against 2-second timeout to prevent hanging
      const pingPromise = redisClient.ping();
      const timeoutPromise = new Promise<string>((_, reject) => 
        setTimeout(() => reject(new Error('Redis PING timeout')), 2000)
      );
      
      const pingResult = await Promise.race([pingPromise, timeoutPromise]);
      checks.redis = pingResult === 'PONG';
    } catch (err) {
      checks.redis = false;
      request.log.error({ err }, 'Redis health check failed');
    }

    const isHealthy = Object.values(checks).every(Boolean);

    if (!isHealthy) {
      return reply.status(503).send({
        status: 'unhealthy',
        checks,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'ok',
      checks,
      timestamp: new Date().toISOString(),
    };
  });
};
