import type { FastifyPluginAsync } from 'fastify';
import { getDb, HitlRepository, JobRepository, JobEventRepository } from '@visa-automation/db';
import type { HitlTaskStatus, HitlTaskType, HitlResolution } from '@visa-automation/shared';
import { JOB_STATES } from '@visa-automation/shared';
import type { JobQueuePayload, ApplicantData, JobConfig, VisaType } from '@visa-automation/shared';
import { enqueueJob } from '../queue/producer.js';

interface TaskParams {
  id: string;
}

interface ListTasksQuery {
  status?: HitlTaskStatus;
  type?: HitlTaskType;
  limit?: string;
  offset?: string;
}

interface ResolveBody {
  resolution: HitlResolution;
}

interface AssignBody {
  assigned_to: string;
}

interface EscalateBody {
  reason: string;
}

export const hitlRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const hitlRepo = new HitlRepository(db);
  const jobRepo = new JobRepository(db);
  const eventRepo = new JobEventRepository(db);

  /**
   * List HITL tasks with filters
   * GET /cp/hitl
   */
  app.get<{ Querystring: ListTasksQuery }>('/', async (request, reply) => {
    const { status, type, limit = '20', offset = '0' } = request.query;

    const result = await hitlRepo.findWithFilters({
      tenantId: request.tenantId,
      status,
      type,
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
   * Get pending tasks count
   * GET /cp/hitl/pending-count
   */
  app.get('/pending-count', async (request, reply) => {
    const count = await hitlRepo.countPendingByTenant(request.tenantId);

    return reply.send({
      success: true,
      data: { count },
    });
  });

  /**
   * Get task by ID with job details
   * GET /cp/hitl/:id
   */
  app.get<{ Params: TaskParams }>('/:id', async (request, reply) => {
    const task = await hitlRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!task) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'HITL task not found' },
      });
    }

    // Get associated job
    const job = await jobRepo.findById(task.job_id);

    return reply.send({
      success: true,
      data: {
        task,
        job,
      },
    });
  });

  /**
   * Assign task to staff member
   * POST /cp/hitl/:id/assign
   */
  app.post<{ Params: TaskParams; Body: AssignBody }>('/:id/assign', async (request, reply) => {
    const task = await hitlRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!task) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'HITL task not found' },
      });
    }

    if (task.status !== 'PENDING') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: `Cannot assign task in ${task.status} status` },
      });
    }

    const updatedTask = await hitlRepo.assign(task.id, request.body.assigned_to);

    return reply.send({
      success: true,
      data: {
        task: updatedTask,
        message: 'Task assigned successfully',
      },
    });
  });

  /**
   * Resolve a HITL task
   * POST /cp/hitl/:id/resolve
   */
  app.post<{ Params: TaskParams; Body: ResolveBody }>('/:id/resolve', async (request, reply) => {
    const task = await hitlRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!task) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'HITL task not found' },
      });
    }

    if (task.status !== 'PENDING' && task.status !== 'ASSIGNED' && task.status !== 'ESCALATED') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: `Cannot resolve task in ${task.status} status` },
      });
    }

    const resolvedBy = request.actorId || request.actorName || 'admin';
    const resolution = request.body.resolution;
    const updatedTask = await hitlRepo.resolve(
      task.id,
      resolution,
      resolvedBy
    );

    // Merge resolution value into job applicant_data so that when job is requeued, DP can fill the field (e.g. enteredCode)
    let job = await jobRepo.findByIdAndTenant(task.job_id, request.tenantId);
    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }
    if (resolution?.value != null) {
      const merged = { ...(job.applicant_data as Record<string, unknown>), enteredCode: resolution.value };
      await jobRepo.update(task.job_id, { applicant_data: merged });
      job = await jobRepo.findByIdAndTenant(task.job_id, request.tenantId) ?? job;
    }

    // Auto-requeue: move job from WAITING_HITL to QUEUED and enqueue so DP continues
    let jobRequeued = false;
    if (job.status === JOB_STATES.WAITING_HITL) {
      const previousStatus = job.status;
      const updatedJob = await jobRepo.updateStatusIf(job.id, job.status, JOB_STATES.QUEUED);
      if (updatedJob) {
        jobRequeued = true;
        await eventRepo.createStateTransition(
          job.id,
          request.tenantId,
          previousStatus,
          JOB_STATES.QUEUED,
          { reason: 'Requeued after HITL resolve' }
        );
        const portalIdRequeue =
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
          portal_id: portalIdRequeue,
          attempt_number: (updatedJob.retry_count ?? 0) + 1,
        };
        try {
          await enqueueJob(queuePayload, { useUniqueId: true });
        } catch (err) {
          request.log.error({ err, jobId: updatedJob.id }, 'Failed to enqueue job after HITL resolve');
          return reply.status(500).send({
            success: false,
            error: {
              code: 'ENQUEUE_FAILED',
              message: 'Task resolved but job could not be requeued. Try requeueing the job manually.',
            },
          });
        }
      }
    }

    return reply.send({
      success: true,
      data: {
        task: updatedTask,
        message: 'Task resolved successfully',
        job_requeued: jobRequeued,
      },
    });
  });

  /**
   * Escalate a HITL task to admin (staff portal)
   * POST /cp/hitl/:id/escalate
   */
  app.post<{ Params: TaskParams; Body: EscalateBody }>('/:id/escalate', async (request, reply) => {
    const task = await hitlRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!task) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'HITL task not found' },
      });
    }

    if (task.status !== 'PENDING' && task.status !== 'ASSIGNED') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: `Cannot escalate task in ${task.status} status` },
      });
    }

    const reason = request.body?.reason?.trim() ?? '';
    if (!reason) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Escalation reason is required' },
      });
    }

    const escalatedBy = request.actorName || request.actorId || 'staff';
    const updatedTask = await hitlRepo.escalate(task.id, reason, escalatedBy);

    if (!updatedTask) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: 'Task state changed, could not escalate' },
      });
    }

    return reply.send({
      success: true,
      data: {
        task: updatedTask,
        message: 'Task escalated to admin for review',
      },
    });
  });

  /**
   * Cancel a HITL task
   * POST /cp/hitl/:id/cancel
   */
  app.post<{ Params: TaskParams }>('/:id/cancel', async (request, reply) => {
    const task = await hitlRepo.findByIdAndTenant(request.params.id, request.tenantId);

    if (!task) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'HITL task not found' },
      });
    }

    if (task.status !== 'PENDING' && task.status !== 'ASSIGNED' && task.status !== 'ESCALATED') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: `Cannot cancel task in ${task.status} status` },
      });
    }

    const cancelledBy = request.actorId || request.actorName || 'admin';
    const updatedTask = await hitlRepo.cancel(task.id, cancelledBy);

    return reply.send({
      success: true,
      data: {
        task: updatedTask,
        message: 'Task cancelled',
      },
    });
  });

  /**
   * Get tasks for a specific job
   * GET /cp/hitl/job/:jobId
   */
  app.get<{ Params: { jobId: string } }>('/job/:jobId', async (request, reply) => {
    const job = await jobRepo.findByIdAndTenant(request.params.jobId, request.tenantId);

    if (!job) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job not found' },
      });
    }

    const tasks = await hitlRepo.findByJobId(job.id);

    return reply.send({
      success: true,
      data: {
        items: tasks,
        total: tasks.length,
      },
    });
  });
};
