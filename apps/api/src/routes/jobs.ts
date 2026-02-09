import type { FastifyPluginAsync } from 'fastify';
import { createHmac } from 'node:crypto';
import { JobService } from '../services/job.service.js';
import { ERROR_CODES, JOB_STATES } from '@visa-automation/shared';
import type { CreateJobRequest, CreateJobBody } from '@visa-automation/shared';
import { JobEventRepository, JobRepository, db } from '@visa-automation/db';

// Helper functions for signed action links
function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function sign(secret: string, jobId: string, action: 'ack' | 'stop', ts: number, nonce: string): string {
  return createHmac('sha256', secret)
    .update(`${jobId}.${action}.${ts}.${nonce}`)
    .digest('base64url');
}

function verifyActionSig(args: {
  jobId: string;
  action: 'ack' | 'stop';
  ts: number;
  nonce: string;
  sig: string;
}): boolean {
  const secret = mustEnv('NOTIFY_ACTION_SECRET');
  const expected = sign(secret, args.jobId, args.action, args.ts, args.nonce);
  if (expected !== args.sig) return false;
  // 10 minute expiry
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - args.ts) <= 600;
}

// Request/Response schemas
interface JobParams {
  id: string;
}

interface ActionQuery {
  ts: string;
  nonce: string;
  sig: string;
  event?: string;
}

export const jobRoutes: FastifyPluginAsync = async (app) => {
  const jobService = new JobService();
  const jobRepo = new JobRepository(db.instance);
  const eventRepo = new JobEventRepository(db.instance);

  /**
   * Create a new job
   * POST /api/jobs
   * 
   * SECURITY: tenant_id comes from authenticated context, NOT from request body
   * TODO: Implement proper authentication middleware to extract tenant_id
   */
  app.post<{ Body: CreateJobBody }>('/', async (request, reply) => {
    const { external_ref, visa_type, priority, applicant, config, portal_id } = request.body;

    // TODO: Extract tenant_id from authenticated request context
    // For now, using a placeholder - THIS MUST BE REPLACED WITH REAL AUTH
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
        tenant_id, // From authenticated context, NOT from body
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

  /**
   * Get job by ID
   * GET /api/jobs/:id
   * 
   * SECURITY: Validates tenant_id to prevent cross-tenant access
   */
  app.get<{ Params: JobParams }>('/:id', async (request, reply) => {
    const { id } = request.params;

    // TODO: Extract tenant_id from authenticated request context
    const tenant_id = request.headers['x-tenant-id'] as string | undefined;
    
    if (!tenant_id) {
      return reply.status(401).send({
        error: true,
        message: 'Authentication required: tenant_id missing from context',
        code: ERROR_CODES.UNAUTHORIZED,
      });
    }

    try {
      const job = await jobService.getJob(id);

      if (!job) {
        return reply.status(404).send({
          error: true,
          message: 'Job not found',
          code: ERROR_CODES.JOB_NOT_FOUND,
        });
      }

      // Tenant isolation: Verify the job belongs to the authenticated tenant
      if (job.tenant_id !== tenant_id) {
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

  /**
   * List jobs for a tenant
   * GET /api/jobs?limit=20&offset=0
   * 
   * SECURITY: tenant_id comes from authenticated context, NOT from query params
   */
  app.get<{ 
    Querystring: { limit?: string; offset?: string } 
  }>('/', async (request, reply) => {
    const { limit, offset } = request.query;
    
    // pagination guard
    const lim = Math.max(1, Math.min(parseInt(limit ?? '20', 10) || 20, 100));
    const off = Math.max(0, parseInt(offset ?? '0', 10) || 0);

    // TODO(auth): Replace x-tenant-id header with JWT / gateway-injected tenant context
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

  /**
   * ACK notification (Telegram button with signed link)
   * GET /api/jobs/:id/ack?ts=...&nonce=...&sig=...&event=slot_open
   * 
   * Records that user acknowledged a notification via Telegram button.
   * Does not change job status, only logs an event.
   * Uses HMAC-SHA256 signature for authentication (no headers needed).
   */
  app.get<{ Params: JobParams; Querystring: ActionQuery }>('/:id/ack', async (request, reply) => {
    const { id } = request.params;
    const { ts, nonce, sig, event } = request.query;

    const ok = verifyActionSig({ jobId: id, action: 'ack', ts: Number(ts), nonce, sig });
    if (!ok) {
      return reply.status(401).type('text/html').send('Invalid or expired link.');
    }

    // Log event without tenant check (signed link is proof of authorization)
    await db.instance
      .insertInto('job_events')
      .values({
        job_id: id,
        tenant_id: '00000000-0000-0000-0000-000000000000', // TEMP: will use signed tenant_id in v2
        event_type: 'NOTIFY_ACK',
        payload: { event: event ?? 'ack', ts: Number(ts) },
      })
      .execute();

    return reply.type('text/html').send('✅ ACK received. You can close this page.');
  });

  /**
   * STOP job (Telegram button with signed link)
   * GET /api/jobs/:id/stop?ts=...&nonce=...&sig=...
   * 
   * Cancels a job via Telegram button action.
   * Updates job status to CANCELLED and logs state transition.
   * Uses HMAC-SHA256 signature for authentication (no headers needed).
   */
  app.get<{ Params: JobParams; Querystring: ActionQuery }>('/:id/stop', async (request, reply) => {
    const { id } = request.params;
    const { ts, nonce, sig } = request.query;

    const ok = verifyActionSig({ jobId: id, action: 'stop', ts: Number(ts), nonce, sig });
    if (!ok) {
      return reply.status(401).type('text/html').send('Invalid or expired link.');
    }

    const job = await jobService.getJob(id);
    if (!job) {
      return reply.status(404).type('text/html').send('Job not found.');
    }

    // Cancel job
    await db.instance
      .updateTable('jobs')
      .set({ status: 'CANCELLED', updated_at: new Date() })
      .where('id', '=', id)
      .execute();

    await db.instance
      .insertInto('job_events')
      .values({
        job_id: id,
        tenant_id: job.tenant_id,
        event_type: 'STATE_TRANSITION',
        payload: { from_state: job.status, to_state: 'CANCELLED', reason: 'STOP link', ts: Number(ts) },
      })
      .execute();

    return reply.type('text/html').send('🛑 Job stopped (CANCELLED). You can close this page.');
  });
};
