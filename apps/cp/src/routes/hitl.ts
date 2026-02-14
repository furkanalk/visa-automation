import type { FastifyPluginAsync } from 'fastify';
import { getDb, HitlRepository, JobRepository } from '@visa-automation/db';
import type { HitlTaskStatus, HitlTaskType, HitlResolution } from '@visa-automation/shared';

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

export const hitlRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const hitlRepo = new HitlRepository(db);
  const jobRepo = new JobRepository(db);

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

    if (task.status !== 'PENDING' && task.status !== 'ASSIGNED') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_STATE', message: `Cannot resolve task in ${task.status} status` },
      });
    }

    const resolvedBy = request.actorId || request.actorName || 'admin';
    const updatedTask = await hitlRepo.resolve(
      task.id,
      request.body.resolution,
      resolvedBy
    );

    return reply.send({
      success: true,
      data: {
        task: updatedTask,
        message: 'Task resolved successfully',
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

    if (task.status !== 'PENDING' && task.status !== 'ASSIGNED') {
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
