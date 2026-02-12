import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { healthRoutes } from './routes/health.js';
import { systemRoutes } from './routes/system.js';
import { agentRoutes } from './routes/agents.js';
import { profileRoutes } from './routes/profiles.js';
import { portalRoutes } from './routes/portals.js';
import { notifyRoutes } from './routes/notify.js';
import { watcherRoutes } from './routes/watcher.js';
import { auditRoutes } from './routes/audit.js';
import { jobRoutes } from './routes/jobs.js';
import { hitlRoutes } from './routes/hitl.js';
import { settingsRoutes } from './routes/settings.js';
import { customerRoutes } from './routes/customers.js';
import { tenantMiddleware } from './middleware/tenant.js';
import { auditPreHandler, auditOnSend } from './middleware/audit.js';
import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'development' 
        ? { target: 'pino-pretty' } 
        : undefined,
    },
  });

  // Security plugins
  await app.register(helmet);
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? true,
  });

  // Health check routes (no auth required)
  await app.register(healthRoutes, { prefix: '/cp/health' });
  await app.register(systemRoutes, { prefix: '/cp/system' });

  // Control Plane routes (all require tenant context)
  await app.register(async (cpApp) => {
    // Apply tenant middleware to all /cp routes
    cpApp.addHook('preHandler', tenantMiddleware);
    
    // Apply audit middleware: capture body in preHandler, write log in onSend
    cpApp.addHook('preHandler', auditPreHandler);
    cpApp.addHook('onSend', auditOnSend);

    // Register CP routes
    await cpApp.register(agentRoutes, { prefix: '/agents' });
    await cpApp.register(profileRoutes, { prefix: '/profiles' });
    await cpApp.register(portalRoutes, { prefix: '/portals' });
    await cpApp.register(notifyRoutes, { prefix: '/notify' });
    await cpApp.register(watcherRoutes, { prefix: '/watcher' });
    await cpApp.register(auditRoutes, { prefix: '/audit' });
    await cpApp.register(jobRoutes, { prefix: '/jobs' });
    await cpApp.register(hitlRoutes, { prefix: '/hitl' });
    await cpApp.register(settingsRoutes, { prefix: '/settings' });
    await cpApp.register(customerRoutes, { prefix: '/customers' });
  }, { prefix: '/cp' });

  // Global error handler
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    app.log.error({ err: error, url: request.url }, 'Request error');

    const statusCode = error.statusCode ?? 500;
    const message = statusCode === 500 
      ? 'Internal Server Error' 
      : error.message;

    reply.status(statusCode).send({
      success: false,
      error: {
        code: (error as any).code ?? 'INTERNAL_ERROR',
        message,
      },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  });

  return app;
}
