import type { FastifyPluginAsync } from 'fastify';
import { getDb, JobRepository, JobEventRepository } from '@visa-automation/db';
import { JOB_STATES, isTerminalState, canTransitionFromTo } from '@visa-automation/shared';

interface JobParams {
  id: string;
}

interface ListJobsQuery {
  status?: string;
  visa_type?: string;
  limit?: string;
  offset?: string;
}

export const jobRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const jobRepo = new JobRepository(db);
  const eventRepo = new JobEventRepository(db);

  /**
   * List jobs with filters
   * GET /cp/jobs
   */
  app.get<{ Querystring: ListJobsQuery }>('/', async (request, reply) => {
    const { status, visa_type, limit = '20', offset = '0' } = request.query;

    const result = await jobRepo.findWithFilters({
      tenantId: request.tenantId,
      status,
      visaType: visa_type,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });

    return reply.send({
      success: true,
      data: {
        items: result.items,
        total: result.total,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      },
    });
  });

  /**
   * Batch get job statuses (performance optimization)
   * POST /cp/jobs/batch-status
   * Body: { ids: string[] }
   * Returns: { [jobId]: status }
   */
  app.post<{ Body: { ids: string[] } }>('/batch-status', async (request, reply) => {
    const { ids } = request.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'ids array is required' },
      });
    }

    // Limit to prevent abuse
    const limitedIds = ids.slice(0, 100);

    // Batch fetch jobs by IDs
    const jobs = await jobRepo.findByIds(request.tenantId, limitedIds);

    // Build status map
    const statuses: Record<string, string | null> = {};
    for (const id of limitedIds) {
      const job = jobs.find((j) => j.id === id);
      statuses[id] = job?.status ?? null;
    }

    return reply.send({
      success: true,
      data: statuses,
    });
  });

  /**
   * Get job by ID
   * GET /cp/jobs/:id
   */
  app.get<{ Params: JobParams }>('/:id', async (request, reply) => {
    const job = await jobRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    return reply.send({
      success: true,
      data: job,
    });
  });

  /**
   * Stop/cancel a job
   * POST /cp/jobs/:id/stop
   */
  app.post<{ Params: JobParams; Body: { reason?: string } }>('/:id/stop', async (request, reply) => {
    const job = await jobRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    if (!canTransitionFromTo(job.status, JOB_STATES.CANCELLED)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: `Job is already in terminal state: ${job.status}` },
      });
    }

    const previousStatus = job.status;
    const updatedJob = await jobRepo.updateStatusIf(job.id, job.status, JOB_STATES.CANCELLED);

    if (!updatedJob) {
      return reply.status(409).send({
        success: false,
        error: { code: 'CONFLICT', message: 'Job status changed; please retry' },
      });
    }

    // Create state transition event
    await eventRepo.createStateTransition(
      job.id,
      request.tenantId,
      previousStatus,
      JOB_STATES.CANCELLED,
      { reason: request.body?.reason || 'Stopped by admin' }
    );

    return reply.send({
      success: true,
      data: {
        job: updatedJob,
        message: 'Job cancelled successfully',
      },
    });
  });

  /**
   * Retry a failed job
   * POST /cp/jobs/:id/retry
   */
  app.post<{ Params: JobParams }>('/:id/retry', async (request, reply) => {
    const job = await jobRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    const retryableStates = [JOB_STATES.FAILED_RETRYABLE, JOB_STATES.FAILED_TERMINAL, JOB_STATES.CANCELLED];
    if (!retryableStates.includes(job.status as any)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: `Job cannot be retried from state: ${job.status}` },
      });
    }

    const maxRetries = job.max_retries ?? 3;
    if ((job.retry_count ?? 0) >= maxRetries) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MAX_RETRIES_EXCEEDED', message: `Job already at max_retries (${maxRetries})` },
      });
    }

    if (!canTransitionFromTo(job.status, JOB_STATES.QUEUED)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: `Cannot retry from state: ${job.status}` },
      });
    }

    const previousStatus = job.status;
    const updatedJob = await jobRepo.updateStatusIf(job.id, job.status, JOB_STATES.QUEUED, {
      retry_count: (job.retry_count || 0) + 1,
    });

    if (!updatedJob) {
      return reply.status(409).send({
        success: false,
        error: { code: 'CONFLICT', message: 'Job status changed; please retry' },
      });
    }

    // Create state transition event
    await eventRepo.createStateTransition(
      job.id,
      request.tenantId,
      previousStatus,
      JOB_STATES.QUEUED,
      { reason: 'Retried by admin' }
    );

    // TODO: Re-enqueue to BullMQ if needed

    return reply.send({
      success: true,
      data: {
        job: updatedJob,
        message: 'Job queued for retry',
      },
    });
  });

  /**
   * Requeue a job (reset to QUEUED without incrementing retry count)
   * POST /cp/jobs/:id/requeue
   */
  app.post<{ Params: JobParams }>('/:id/requeue', async (request, reply) => {
    const job = await jobRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    if (isTerminalState(job.status as any) && job.status !== JOB_STATES.CANCELLED) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: `Completed jobs cannot be requeued` },
      });
    }

    const previousStatus = job.status;
    const updatedJob = await jobRepo.updateStatusIf(job.id, job.status, JOB_STATES.QUEUED);

    if (!updatedJob) {
      return reply.status(409).send({
        success: false,
        error: { code: 'CONFLICT', message: 'Job status changed; please retry' },
      });
    }

    // Create state transition event
    await eventRepo.createStateTransition(
      job.id,
      request.tenantId,
      previousStatus,
      JOB_STATES.QUEUED,
      { reason: 'Requeued by admin' }
    );

    return reply.send({
      success: true,
      data: {
        job: updatedJob,
        message: 'Job requeued successfully',
      },
    });
  });

  /**
   * Get job events/timeline
   * GET /cp/jobs/:id/events
   */
  app.get<{ Params: JobParams; Querystring: { limit?: string } }>('/:id/events', async (request, reply) => {
    const job = await jobRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    const limit = parseInt(request.query.limit ?? '50', 10);
    const events = await eventRepo.findByJobId(job.id, limit);

    return reply.send({
      success: true,
      data: {
        items: events,
        total: events.length,
      },
    });
  });

  /**
   * Get job runs (execution history)
   * GET /cp/jobs/:id/runs
   */
  app.get<{ Params: JobParams }>('/:id/runs', async (request, reply) => {
    const job = await jobRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    // Filter events to get only run-related events
    const allEvents = await eventRepo.findByJobId(job.id, 100);
    const runEvents = allEvents.filter(e => 
      ['state_transition', 'job_started', 'job_completed', 'job_failed'].includes(e.event_type)
    );

    return reply.send({
      success: true,
      data: {
        items: runEvents,
        total: runEvents.length,
        retry_count: job.retry_count,
      },
    });
  });
};
