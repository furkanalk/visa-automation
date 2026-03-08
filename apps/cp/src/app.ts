import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { systemRoutes } from './routes/system.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { agentRoutes } from './routes/agents.js';
import { profileRoutes } from './routes/profiles.js';
import { portalRoutes } from './routes/portals.js';
import { notifyRoutes } from './routes/notify.js';
import { watcherRoutes } from './routes/watcher.js';
import { auditRoutes } from './routes/audit.js';
import { jobRoutes } from './routes/jobs.js';
import { hitlRoutes } from './routes/hitl.js';
import { screenshotRoutes } from './routes/screenshots.js';
import { settingsRoutes } from './routes/settings.js';
import { customerRoutes } from './routes/customers.js';
import { staffRoutes } from './routes/staff.js';
import { authRoutes } from './routes/auth.js';
import { mockPortalRoutes } from './routes/mock-portal.js';
import { bugReportRoutes } from './routes/bug-report.js';
import { publicJobRoutes } from './routes/public-jobs.js';
import { receiptRoutes } from './routes/receipt.js';
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

  // Health and metrics (no auth required)
  await app.register(healthRoutes, { prefix: '/cp/health' });
  await app.register(metricsRoutes, { prefix: '/cp/metrics' });
  await app.register(systemRoutes, { prefix: '/cp/system' });
  await app.register(dashboardRoutes, { prefix: '/cp/dashboard' });

  // Public static assets (no auth)
  app.get('/cp/static/banner-email.png', async (_request, reply) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const bannerPath = join(__dirname, '..', '..', 'banner-email.png');
    try {
      const file = readFileSync(bannerPath);
      reply.header('Content-Type', 'image/png');
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(file);
    } catch {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Banner not found' } });
    }
  });

  // Public API routes (same contract as former apps/api; no tenant middleware)
  await app.register(publicJobRoutes, { prefix: '/api/jobs' });

  // Receipt PDF endpoint — has its own token-based auth (also works with CP session cookie via tenantMiddleware)
  await app.register(receiptRoutes, { prefix: '/cp/jobs' });

  // Control Plane routes (all require tenant context)
  await app.register(async (cpApp) => {
    // Apply tenant middleware to all /cp routes
    cpApp.addHook('preHandler', tenantMiddleware);

    // Bind request-scoped logger with tenant_id for structured logs
    cpApp.addHook('preHandler', (request, _reply, done) => {
      (request as any).log = request.log.child({ tenant_id: request.tenantId });
      done();
    });
    
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
    await cpApp.register(screenshotRoutes, { prefix: '/screenshots' });
    await cpApp.register(settingsRoutes, { prefix: '/settings' });
    await cpApp.register(customerRoutes, { prefix: '/customers' });
    await cpApp.register(staffRoutes); // /cp/staff
    await cpApp.register(authRoutes, { prefix: '/auth' }); // /cp/auth (tenant optional for invite)
    await cpApp.register(mockPortalRoutes, { prefix: '/mock-portal' }); // /cp/mock-portal/:portalId/config
    await cpApp.register(bugReportRoutes, { prefix: '/bug-report' }); // /cp/bug-report
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
