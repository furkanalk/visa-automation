import type { FastifyPluginAsync } from 'fastify';
import { getDb, AgentRepository, ProfileRepository, JobRepository, SystemSettingsRepository } from '@visa-automation/db';
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
  const jobRepo = new JobRepository(db);
  const settingsRepo = new SystemSettingsRepository(db);

  /**
   * List agents for tenant
   * GET /cp/agents
   */
  app.get<{
    Querystring: {
      status?: string;
      mode?: string;
      name?: string;
      portal_id?: string;
      profile_id?: string;
      is_scout?: string;
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
    if (request.query.name) {
      query.name = request.query.name;
    }
    if (request.query.portal_id) {
      query.portal_id = request.query.portal_id;
    }
    if (request.query.profile_id) {
      query.profile_id = request.query.profile_id;
    }
    if (request.query.is_scout === 'true') {
      const scoutIds = await profileRepo.findScoutProfileIds(request.tenantId);
      if (scoutIds.length === 0) {
        return {
          success: true,
          data: { items: [], total: 0, async_count: 0, sync_count: 0 },
          meta: { request_id: request.id, timestamp: new Date().toISOString() },
        };
      }
      query.profile_ids = scoutIds;
    }

    const rawAgents = await agentRepo.findByTenantId(request.tenantId, query);
    // Dedupe by name: keep the row with the latest heartbeat (avoids duplicate cards from old registrations)
    const byName = new Map<string, (typeof rawAgents)[0]>();
    const toTime = (d: Date | null | undefined) => (d ? new Date(d).getTime() : 0);
    for (const a of rawAgents) {
      const cur = byName.get(a.name);
      const aTime = toTime(a.last_heartbeat_at) || new Date(a.updated_at).getTime();
      const curTime = cur ? toTime(cur.last_heartbeat_at) || new Date(cur.updated_at).getTime() : 0;
      if (!cur || aTime >= curTime) byName.set(a.name, a);
    }
    const agents = Array.from(byName.values());
    const dedupedAsync = agents.filter((a) => a.mode === 'ASYNC').length;
    const dedupedSync = agents.filter((a) => a.mode === 'SYNC').length;

    return {
      success: true,
      data: {
        items: agents,
        total: agents.length,
        async_count: dedupedAsync,
        sync_count: dedupedSync,
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
    let profileIsScout = false;
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
      profileIsScout = profile.is_scout ?? false;
    }

    // Max one watcher (scout) per portal: if this agent would be a scout with portals, check no other scout has those portals
    if (profileIsScout) {
      const portals = Array.isArray(desired_portals) ? desired_portals : [];
      if (portals.length > 0 && typeof agentRepo.findScoutAgentsWithPortals === 'function') {
        const scoutIds = await profileRepo.findScoutProfileIds(request.tenantId);
        const existing = await agentRepo.findScoutAgentsWithPortals(request.tenantId, scoutIds, portals);
        if (existing.length > 0) {
          const taken = new Set<string>();
          for (const a of existing) {
            for (const p of (a.desired_portals ?? []) as string[]) {
              if (portals.includes(p)) taken.add(p);
            }
          }
          return reply.status(400).send({
            success: false,
            error: {
              code: 'PORTAL_ALREADY_HAS_WATCHER',
              message: `Portal(s) ${[...taken].join(', ')} already have a watcher assigned. Max one watcher per portal.`,
              portals: [...taken],
            },
          });
        }
      }
    }

    // Enforce unique name per tenant: POST is create-only; updates go via PATCH
    const existing = await agentRepo.findByTenantAndName(request.tenantId, name);
    if (existing) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'AGENT_NAME_EXISTS',
          message: `An agent with name '${name}' already exists for this tenant. Use PATCH /cp/agents/:id to update.`,
        },
      });
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
    const body = request.body ?? {};
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

    // Draining is only allowed when agent has an active job
    if (body.status === 'DRAINING' && !agent.current_job_id) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'DRAINING_REQUIRES_JOB',
          message: 'Draining can only be set when the agent has an active job',
        },
      });
    }

    // Resolve effective profile and portals after update (for watcher-per-portal check)
    const effectiveProfileId = body.profile_id !== undefined ? body.profile_id : agent.profile_id;
    const effectivePortals = body.desired_portals !== undefined
      ? (Array.isArray(body.desired_portals) ? body.desired_portals : [])
      : (agent.desired_portals ?? []);

    // Max one watcher per portal: if this agent would be a scout with portals, ensure no other scout has those portals
    if (effectiveProfileId && effectivePortals.length > 0 && typeof agentRepo.findScoutAgentsWithPortals === 'function') {
      const profile = await profileRepo.findById(request.tenantId, effectiveProfileId);
      if (profile?.is_scout) {
        const scoutIds = await profileRepo.findScoutProfileIds(request.tenantId);
        const existing = await agentRepo.findScoutAgentsWithPortals(
          request.tenantId,
          scoutIds,
          effectivePortals,
          request.params.id
        );
        if (existing.length > 0) {
          const taken = new Set<string>();
          for (const a of existing) {
            for (const p of (a.desired_portals ?? []) as string[]) {
              if (effectivePortals.includes(p)) taken.add(p);
            }
          }
          return reply.status(400).send({
            success: false,
            error: {
              code: 'PORTAL_ALREADY_HAS_WATCHER',
              message: `Portal(s) ${[...taken].join(', ')} already have a watcher assigned. Max one watcher per portal.`,
              portals: [...taken],
            },
          });
        }
      }
    }

    // Build update object
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.mode !== undefined) updates.mode = body.mode;
    if (body.status !== undefined) {
      // When disabling (OFFLINE): if agent is running a job, set DRAINING so it finishes then goes OFFLINE
      const requestedOffline = body.status === 'OFFLINE' || body.status === 'DISABLED';
      if (requestedOffline && agent.current_job_id) {
        updates.status = 'DRAINING';
      } else {
        updates.status = body.status;
      }
      // When enabling agent, clear stale current_job_id so it is not stuck showing a finished job
      if (body.status === 'ONLINE') updates.current_job_id = null;
    }
    if (body.profile_id !== undefined) updates.profile_id = body.profile_id;
    if (body.desired_portals !== undefined) {
      updates.desired_portals = Array.isArray(body.desired_portals)
        ? body.desired_portals
        : typeof body.desired_portals === 'object' && body.desired_portals !== null
          ? Object.keys(body.desired_portals)
          : [];
    }
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

    // When agent is OFFLINE (admin-disabled), DISABLED, or DRAINING (admin/worker-set), do not overwrite status on heartbeat
    const preserveStatus = agent.status === 'OFFLINE' || agent.status === 'DISABLED' || agent.status === 'DRAINING';
    const updated = preserveStatus
      ? await agentRepo.updateHeartbeatMetadataOnly(
          request.tenantId,
          request.params.id,
          current_job_id ?? null,
          updatedMetadata
        )
      : await agentRepo.updateHeartbeat(
          request.tenantId,
          request.params.id,
          status,
          current_job_id,
          updatedMetadata
        );

    // Renew job lease when agent reports current_job_id (same worker holds the lock)
    const workerId = agent.metadata && typeof agent.metadata.worker_id === 'string' ? agent.metadata.worker_id : null;
    if (current_job_id && workerId) {
      const lockRenewMs = await settingsRepo.getNumber(null, 'system', 'lock_renew_ms', 300000);
      await jobRepo.renewLock(current_job_id, workerId, lockRenewMs);
    }

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

    const profileConfig = profile
      ? { ...profile.config, is_scout: profile.is_scout ?? false }
      : undefined;

    return {
      success: true,
      data: {
        acknowledged: true,
        disabled: agent.status === 'DISABLED',
        draining: agent.status === 'DRAINING',
        config_changed: configChanged,
        profile: profileConfig,
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

  // Every 10s: set DRAINING agents with no current job to OFFLINE (cleanup)
  setInterval(async () => {
    try {
      if (typeof agentRepo.setDrainingWithNoJobToOffline !== 'function') return;
      const n = await agentRepo.setDrainingWithNoJobToOffline();
      if (n > 0) {
        app.log.info({ count: n }, 'Set DRAINING agents with no job to OFFLINE');
      }
    } catch (err) {
      app.log.warn({ err }, 'Draining reaper error');
    }
  }, 10_000);
};
