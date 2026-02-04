import type { FastifyPluginAsync } from 'fastify';
import { JobService } from '../services/job.service.js';
import { ERROR_CODES } from '@visa-automation/shared';
import type { CreateJobRequest, CreateJobBody } from '@visa-automation/shared';

// Request/Response schemas
interface JobParams {
  id: string;
}

export const jobRoutes: FastifyPluginAsync = async (app) => {
  const jobService = new JobService();

  /**
   * Create a new job
   * POST /api/jobs
   * 
   * SECURITY: tenant_id comes from authenticated context, NOT from request body
   * TODO: Implement proper authentication middleware to extract tenant_id
   */
  app.post<{ Body: CreateJobBody }>('/', async (request, reply) => {
    const { external_ref, visa_type, priority, applicant, config } = request.body;

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
};
