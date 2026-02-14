import type { FastifyPluginAsync } from 'fastify';
import { getDb, SystemSettingsRepository } from '@visa-automation/db';
import { JobService } from '../services/job.service.js';
import { ERROR_CODES } from '@visa-automation/shared';
import type { CreateJobRequest, CreateJobBody } from '@visa-automation/shared';

/**
 * Public job API routes (same contract as former apps/api).
 * Prefix: /api/jobs
 * - POST /   create job (x-tenant-id required)
 * - GET /    list jobs (x-tenant-id required)
 * - GET /:id get job (x-tenant-id required, tenant isolation)
 * - GET /:id/stop  Telegram stop (token query required)
 * - GET /:id/ack   Telegram ack (token query required)
 */
interface JobParams {
  id: string;
}

export const publicJobRoutes: FastifyPluginAsync = async (app) => {
  const jobService = new JobService();
  const settingsRepo = new SystemSettingsRepository(getDb());

  async function getActionToken(): Promise<string | undefined> {
    const raw = await settingsRepo.getValue(null, 'notify', 'notify_action_token');
    if (raw === undefined || raw === null) return undefined;
    return typeof raw === 'string' ? raw : String(raw);
  }

  async function assertActionToken(token?: string) {
    const expected = await getActionToken();
    if (!expected || expected === 'changeme') {
      const err: any = new Error('Notify action token not configured. Set system_settings notify.notify_action_token.');
      err.statusCode = 503;
      err.code = 'CONFIG_NOT_READY';
      throw err;
    }
    if (!token || token !== expected) {
      const err: any = new Error('Unauthorized');
      err.statusCode = 401;
      err.code = ERROR_CODES.UNAUTHORIZED;
      throw err;
    }
  }

  // Telegram action: STOP (token-protected)
  app.get<{ Params: JobParams; Querystring: { token?: string } }>('/:id/stop', async (request) => {
    await assertActionToken(request.query.token);
    await jobService.cancelJobByToken(request.params.id);
    return { ok: true };
  });

  // Telegram action: ACK (token-protected)
  app.get<{
    Params: JobParams;
    Querystring: { event?: string; token?: string };
  }>('/:id/ack', async (request) => {
    await assertActionToken(request.query.token);
    await jobService.ackJobEventByToken(request.params.id, request.query.event ?? 'ack');
    return { ok: true };
  });

  /** Create job - POST /api/jobs. Requires x-tenant-id. */
  app.post<{ Body: CreateJobBody }>('/', async (request, reply) => {
    const { external_ref, visa_type, priority, applicant, config, portal_id } = request.body;
    const tenant_id = request.headers['x-tenant-id'] as string | undefined;

    if (!tenant_id) {
      return reply.status(401).send({
        error: true,
        message: 'Authentication required: tenant_id missing from context',
        code: ERROR_CODES.UNAUTHORIZED,
      });
    }
    if (!portal_id) {
      return reply.status(400).send({
        error: true,
        message: 'portal_id is required',
        code: ERROR_CODES.VALIDATION_ERROR,
      });
    }
    if (!visa_type) {
      return reply.status(400).send({
        error: true,
        message: 'visa_type is required',
        code: ERROR_CODES.VALIDATION_ERROR,
      });
    }
    if (!applicant?.name) {
      return reply.status(400).send({
        error: true,
        message: 'applicant.name is required',
        code: ERROR_CODES.VALIDATION_ERROR,
      });
    }

    try {
      const createRequest: CreateJobRequest = {
        tenant_id,
        external_ref,
        visa_type,
        priority,
        applicant,
        config,
        portal_id,
      };
      const result = await jobService.createJob(createRequest);
      return reply.status(201).send(result);
    } catch (err) {
      request.log.error({ err }, 'Failed to create job');
      throw err;
    }
  });

  /** Get job - GET /api/jobs/:id. Requires x-tenant-id, tenant isolation. */
  app.get<{ Params: JobParams }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const tenant_id = request.headers['x-tenant-id'] as string | undefined;

    if (!tenant_id) {
      return reply.status(401).send({
        error: true,
        message: 'Authentication required: tenant_id missing from context',
        code: ERROR_CODES.UNAUTHORIZED,
      });
    }

    try {
      const resolvedTenantId = await jobService.resolveTenantId(tenant_id);
      const job = await jobService.getJob(id);
      if (!job) {
        return reply.status(404).send({
          error: true,
          message: 'Job not found',
          code: ERROR_CODES.JOB_NOT_FOUND,
        });
      }
      if (job.tenant_id !== resolvedTenantId) {
        return reply.status(403).send({
          error: true,
          message: 'Access denied: Job belongs to a different tenant',
          code: ERROR_CODES.FORBIDDEN,
        });
      }
      return job;
    } catch (err) {
      request.log.error({ err, jobId: id }, 'Failed to get job');
      throw err;
    }
  });

  /** List jobs - GET /api/jobs. Requires x-tenant-id. */
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/', async (request, reply) => {
    const { limit, offset } = request.query;
    const lim = Math.max(1, Math.min(parseInt(limit ?? '20', 10) || 20, 100));
    const off = Math.max(0, parseInt(offset ?? '0', 10) || 0);
    const tenant_id = request.headers['x-tenant-id'] as string | undefined;

    if (!tenant_id) {
      return reply.status(401).send({
        error: true,
        message: 'Authentication required: tenant_id missing from context',
        code: ERROR_CODES.UNAUTHORIZED,
      });
    }

    try {
      const jobs = await jobService.listJobs(tenant_id, lim, off);
      return { data: jobs, total: jobs.length };
    } catch (err) {
      request.log.error({ err, tenantId: tenant_id }, 'Failed to list jobs');
      throw err;
    }
  });
};
