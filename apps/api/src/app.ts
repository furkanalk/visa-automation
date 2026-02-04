import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { healthRoutes } from './routes/health.js';
import { jobRoutes } from './routes/jobs.js';
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
  await app.register(healthRoutes, { prefix: '/health' });

  // API routes
  await app.register(jobRoutes, { prefix: '/api/jobs' });

  // Global error handler
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    app.log.error(error);

    const statusCode = error.statusCode ?? 500;
    const message = statusCode === 500 
      ? 'Internal Server Error' 
      : error.message;

    reply.status(statusCode).send({
      error: true,
      message,
      code: (error as any).code ?? 'INTERNAL_ERROR',
    });
  });

  return app;
}
