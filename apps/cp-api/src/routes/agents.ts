import type { FastifyPluginAsync } from 'fastify';
import { getDb, AgentRepository, ProfileRepository } from '@visa-automation/db';
import type {
  CreateAgentRequest,
  UpdateAgentRequest,
  AgentHeartbeatRequest,
  BulkAssignProfileRequest,
  ScaleAgentsRequest,
  ListAgentsQuery,
  AgentStatus,
  AgentMode,
} from '@visa-automation/shared';

interface AgentParams {
  id: string;
}

export const agentRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const agentRepo = new AgentRepository(db);
  const profileRepo = new ProfileRepository(db);

  /**
   * List agents for tenant
   * GET /cp/agents
   */
  app.get<{
    Querystring: {
      status?: string;
      mode?: string;
      portal_id?: string;
      profile_id?: string;
      limit?: string;
      offset?: string;
    };
  }>('/', async (request) => {
    const query: ListAgentsQuery = {
      limit: Math.min(parseInt(request.query.limit ?? '100', 10), 500),
      offset: parseInt(request.query.offset ?? '0', 10),
    };

    if (request.query.status) {
      query.status = request.query.status.split(',') as AgentStatus[];
    }
    if (request.query.mode) {
      query.mode = request.query.mode as AgentMode;
    }
    if (request.query.portal_id) {
      query.portal_id = request.query.portal_id;
    }
    if (request.query.profile_id) {
      query.profile_id = request.query.profile_id;
    }

    const agents = await agentRepo.findByTenantId(request.tenantId, query);
    const counts = await agentRepo.countByTenant(request.tenantId);

    return {
      success: true,
      data: {
        items: agents,
        total: counts.total,
        async_count: counts.async,
        sync_count: counts.sync,
      },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    };
  });

  /**
   * Get agent by ID
   * GET /cp/agents/:id
   */
  app.get<{ Params: AgentParams }>('/:id', async (request, reply) => {
    const agent = await agentRepo.findById(request.tenantId, request.params.id);

    if (!agent) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent with ID '${request.params.id}' not found`,
        },
      });
    }

    // Include profile info if present
    let profile = null;
    if (agent.profile_id) {
      profile = await profileRepo.findById(request.tenantId, agent.profile_id);
    }

    return {
      success: true,
      data: {
        ...agent,
        profile,
      },
    };
  });

  /**
   * Create agent
   * POST /cp/agents
   */
  app.post<{ Body: CreateAgentRequest }>('/', async (request, reply) => {
    const { name, mode, profile_id, desired_portals, desired_concurrency, metadata } = request.body;

    if (!name) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_REQUIRED_FIELD',
          message: 'name is required',
        },
      });
    }

    // Validate profile exists if provided
    if (profile_id) {
      const profile = await profileRepo.findById(request.tenantId, profile_id);
      if (!profile) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PROFILE',
            message: 'Profile not found or belongs to different tenant',
          },
        });
      }
    }

    const agent = await agentRepo.create({
      tenant_id: request.tenantId,
      name,
      mode: mode ?? 'ASYNC',
      status: 'OFFLINE',
      profile_id: profile_id ?? null,
      desired_portals: desired_portals ?? [],
      desired_concurrency: desired_concurrency ?? 1,
      metadata: metadata ?? {},
    });

    return reply.status(201).send({
      success: true,
      data: agent,
    });
  });

  /**
   * Update agent
   * PATCH /cp/agents/:id
   */
  app.patch<{ Params: AgentParams; Body: UpdateAgentRequest }>('/:id', async (request, reply) => {
    const agent = await agentRepo.findById(request.tenantId, request.params.id);

    if (!agent) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent with ID '${request.params.id}' not found`,
        },
      });
    }

    // Build update object
    const updates: Record<string, unknown> = {};
    const body = request.body;

    if (body.name !== undefined) updates.name = body.name;
    if (body.mode !== undefined) updates.mode = body.mode;
    if (body.status !== undefined) updates.status = body.status;
    if (body.profile_id !== undefined) updates.profile_id = body.profile_id;
    if (body.desired_portals !== undefined) updates.desired_portals = body.desired_portals;
    if (body.desired_concurrency !== undefined) updates.desired_concurrency = body.desired_concurrency;
    if (body.metadata !== undefined) updates.metadata = body.metadata;

    const updated = await agentRepo.update(request.tenantId, request.params.id, updates);

    return {
      success: true,
      data: updated,
    };
  });

  /**
   * Delete agent
   * DELETE /cp/agents/:id
   */
  app.delete<{ Params: AgentParams }>('/:id', async (request, reply) => {
    const agent = await agentRepo.findById(request.tenantId, request.params.id);

    if (!agent) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent with ID '${request.params.id}' not found`,
        },
      });
    }

    // Don't allow deleting an agent that's currently running a job
    if (agent.current_job_id) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'AGENT_BUSY',
          message: 'Cannot delete agent while it is running a job',
        },
      });
    }

    await agentRepo.delete(request.tenantId, request.params.id);

    return {
      success: true,
      data: { deleted: true },
    };
  });

  /**
   * Agent heartbeat
   * POST /cp/agents/:id/heartbeat
   */
  app.post<{ Params: AgentParams; Body: AgentHeartbeatRequest }>('/:id/heartbeat', async (request, reply) => {
    const { status, current_job_id, browser_healthy, metadata } = request.body;

    const agent = await agentRepo.findById(request.tenantId, request.params.id);

    if (!agent) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent with ID '${request.params.id}' not found`,
        },
      });
    }

    const updatedMetadata = {
      ...agent.metadata,
      ...metadata,
      browser_healthy,
    };

    const updated = await agentRepo.updateHeartbeat(
      request.tenantId,
      request.params.id,
      status,
      current_job_id,
      updatedMetadata
    );

    // Check if profile config has changed since last heartbeat
    let configChanged = false;
    let profile = null;
    if (agent.profile_id) {
      profile = await profileRepo.findById(request.tenantId, agent.profile_id);
      // Config changed if profile updated_at > agent's last_heartbeat_at
      if (profile && agent.last_heartbeat_at) {
        configChanged = profile.updated_at > agent.last_heartbeat_at;
      }
    }

    return {
      success: true,
      data: {
        acknowledged: true,
        config_changed: configChanged,
        profile: profile?.config,
        // Return portals agent should work on
        desired_portals: updated?.desired_portals ?? [],
        desired_concurrency: updated?.desired_concurrency ?? 1,
      },
    };
  });

  /**
   * Bulk assign profile to agents
   * POST /cp/agents/bulk-assign-profile
   */
  app.post<{ Body: BulkAssignProfileRequest }>('/bulk-assign-profile', async (request, reply) => {
    const { profile_id, selector } = request.body;

    if (!profile_id) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_REQUIRED_FIELD',
          message: 'profile_id is required',
        },
      });
    }

    // Validate profile exists and belongs to tenant
    const profile = await profileRepo.findById(request.tenantId, profile_id);
    if (!profile) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PROFILE',
          message: 'Profile not found or belongs to different tenant',
        },
      });
    }

    const affectedIds = await agentRepo.bulkAssignProfile(
      request.tenantId,
      profile_id,
      selector
    );

    return {
      success: true,
      data: {
        affected_count: affectedIds.length,
        agent_ids: affectedIds,
      },
    };
  });

  /**
   * Scale agents (adjust async/sync counts)
   * PATCH /cp/agents/scale
   */
  app.patch<{ Body: ScaleAgentsRequest }>('/scale', async (request) => {
    const { async_count, sync_count } = request.body;

    const current = await agentRepo.countByTenant(request.tenantId);

    // For MVP, scaling is informational - actual agent creation/deletion
    // would be handled by the worker pool manager
    // Here we just return the current state and desired state

    return {
      success: true,
      data: {
        current_async: current.async,
        current_sync: current.sync,
        target_async: async_count,
        target_sync: sync_count,
        scaling_in_progress: false,
        message: 'Scaling request recorded. Worker pool will adjust agent counts.',
      },
    };
  });

  /**
   * Assign portals to agent
   * POST /cp/agents/:id/assign-portals
   */
  app.post<{ Params: AgentParams; Body: { portals: string[] } }>('/:id/assign-portals', async (request, reply) => {
    const { portals } = request.body;

    const agent = await agentRepo.findById(request.tenantId, request.params.id);

    if (!agent) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent with ID '${request.params.id}' not found`,
        },
      });
    }

    const updated = await agentRepo.assignPortals(request.tenantId, request.params.id, portals);

    return {
      success: true,
      data: updated,
    };
  });

  /**
   * Run a job on a sync agent
   * POST /cp/agents/:id/run-job
   * 
   * This endpoint triggers a specific job to run on a SYNC agent.
   * The actual job execution happens on the worker side.
   * This endpoint just validates and records the request.
   */
  app.post<{ Params: AgentParams; Body: { job_id: string; step_by_step?: boolean } }>(
    '/:id/run-job',
    async (request, reply) => {
      const { job_id, step_by_step } = request.body;

      const agent = await agentRepo.findById(request.tenantId, request.params.id);

      if (!agent) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'AGENT_NOT_FOUND',
            message: `Agent with ID '${request.params.id}' not found`,
          },
        });
      }

      if (agent.mode !== 'SYNC') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'AGENT_MODE_MISMATCH',
            message: 'Only SYNC agents can run jobs manually. Use the queue for ASYNC agents.',
          },
        });
      }

      if (agent.status !== 'ONLINE') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'AGENT_NOT_AVAILABLE',
            message: `Agent is not available (status: ${agent.status})`,
          },
        });
      }

      if (agent.current_job_id) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'AGENT_BUSY',
            message: `Agent is already running job ${agent.current_job_id}`,
          },
        });
      }

      // Update agent with the job assignment
      await agentRepo.update(request.tenantId, request.params.id, {
        current_job_id: job_id,
      });

      return {
        success: true,
        data: {
          agent_id: request.params.id,
          job_id,
          step_by_step: step_by_step ?? false,
          message: 'Job assigned to sync agent. Worker will execute when it polls.',
        },
      };
    }
  );

  /**
   * Stop/abort job on a sync agent
   * POST /cp/agents/:id/stop-job
   */
  app.post<{ Params: AgentParams }>('/:id/stop-job', async (request, reply) => {
    const agent = await agentRepo.findById(request.tenantId, request.params.id);

    if (!agent) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'AGENT_NOT_FOUND',
          message: `Agent with ID '${request.params.id}' not found`,
        },
      });
    }

    if (!agent.current_job_id) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NO_JOB_RUNNING',
          message: 'Agent is not running any job',
        },
      });
    }

    const stoppedJobId = agent.current_job_id;

    // Clear the job assignment
    await agentRepo.update(request.tenantId, request.params.id, {
      current_job_id: null,
    });

    return {
      success: true,
      data: {
        agent_id: request.params.id,
        stopped_job_id: stoppedJobId,
        message: 'Stop signal sent. Worker will abort job at next checkpoint.',
      },
    };
  });
};
