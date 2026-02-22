import type { FastifyPluginAsync } from 'fastify';
import { getDb, JobRepository, JobEventRepository } from '@visa-automation/db';
import { JOB_STATES, isTerminalState, canTransitionFromTo } from '@visa-automation/shared';
import type { JobQueuePayload, ApplicantData, JobConfig, VisaType } from '@visa-automation/shared';
import { enqueueJob } from '../queue/producer.js';

interface JobParams {
  id: string;
}

interface ListJobsQuery {
  status?: string;
  visa_type?: string;
  exclude_slot_check?: string;
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
    const { status, visa_type, exclude_slot_check, limit = '20', offset = '0' } = request.query;

    const result = await jobRepo.findWithFilters({
      tenantId: request.tenantId,
      status,
      visaType: visa_type,
      excludeSlotCheck: exclude_slot_check === 'true' || exclude_slot_check === '1',
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
   * Retry a failed or cancelled job.
   * Use for: FAILED_RETRYABLE, FAILED_TERMINAL, CANCELLED.
   * Increments retry_count (limited by max_retries). Job is set to QUEUED and re-enqueued.
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

    // Re-enqueue to BullMQ so DP workers pick up the job
    const portalId =
      (updatedJob.applicant_data as Record<string, unknown>)?.portal_id as string | undefined ??
      (updatedJob.config as Record<string, unknown>)?.portal_id as string | undefined ??
      'as-visa';
    const queuePayload: JobQueuePayload = {
      job_id: updatedJob.id,
      tenant_id: updatedJob.tenant_id,
      visa_type: updatedJob.visa_type as VisaType,
      priority: updatedJob.priority ?? 50,
      applicant_data: (updatedJob.applicant_data ?? {}) as ApplicantData,
      config: (updatedJob.config ?? {}) as JobConfig,
      portal_id: portalId,
      attempt_number: (updatedJob.retry_count ?? 0) + 1,
    };
    try {
      await enqueueJob(queuePayload, { useUniqueId: true });
    } catch (err) {
      request.log.error({ err, jobId: updatedJob.id }, 'Failed to enqueue job for retry');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'ENQUEUE_FAILED',
          message: 'Job set to QUEUED but failed to re-add to queue. Check Redis and try requeue.',
        },
      });
    }

    return reply.send({
      success: true,
      data: {
        job: updatedJob,
        message: 'Job queued for retry',
      },
    });
  });

  /**
   * Requeue a job: set to QUEUED and re-enqueue without incrementing retry_count.
   * Use for: WAITING_HITL, PAUSED, CANCELLED, or other non-terminal states when you want
   * the job to continue from where it left off (e.g. after HITL resolve if auto-requeue failed).
   * Not allowed for COMPLETED or FAILED_TERMINAL.
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

    // Re-enqueue to BullMQ so DP workers pick up the job
    const portalIdRequeue =
      (updatedJob.applicant_data as Record<string, unknown>)?.portal_id as string | undefined ??
      (updatedJob.config as Record<string, unknown>)?.portal_id as string | undefined ??
      'as-visa';
    const queuePayloadRequeue: JobQueuePayload = {
      job_id: updatedJob.id,
      tenant_id: updatedJob.tenant_id,
      visa_type: updatedJob.visa_type as VisaType,
      priority: updatedJob.priority ?? 50,
      applicant_data: (updatedJob.applicant_data ?? {}) as ApplicantData,
      config: (updatedJob.config ?? {}) as JobConfig,
      portal_id: portalIdRequeue,
      attempt_number: (updatedJob.retry_count ?? 0) + 1,
    };
    try {
      await enqueueJob(queuePayloadRequeue, { useUniqueId: true });
    } catch (err) {
      request.log.error({ err, jobId: updatedJob.id }, 'Failed to enqueue job for requeue');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'ENQUEUE_FAILED',
          message: 'Job set to QUEUED but failed to re-add to queue. Check Redis and try again.',
        },
      });
    }

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
   * Get job runs (execution history from job_runs table, with agent name)
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

    const runs = await jobRepo.findJobRunsByJobId(job.id, job.tenant_id);

    return reply.send({
      success: true,
      data: {
        items: runs.map((r) => ({
          id: r.id,
          job_id: r.job_id,
          tenant_id: r.tenant_id,
          worker_id: r.worker_id,
          agent_id: r.agent_id,
          agent_name: r.agent_name ?? null,
          attempt_number: r.attempt_number,
          status: r.status,
          started_at: r.started_at,
          finished_at: r.finished_at,
          error_code: r.error_code,
          error_message: r.error_message,
        })),
        total: runs.length,
        retry_count: job.retry_count,
      },
    });
  });
};
