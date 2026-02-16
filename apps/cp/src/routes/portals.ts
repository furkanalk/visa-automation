import type { FastifyPluginAsync } from 'fastify';
import { getDb, PortalConfigRepository, AgentRepository } from '@visa-automation/db';
import type {
  CreatePortalConfigRequest,
  UpdatePortalConfigRequest,
  AssignAgentsToPortalRequest,
} from '@visa-automation/shared';
import { validatePortalConfig, validatePortalSelectors } from '../schemas/validate-config.js';

export const portalRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const portalRepo = new PortalConfigRepository(db);
  const agentRepo = new AgentRepository(db);

  /**
   * Get portal by portal_id (MUST be before /:id to avoid route conflict)
   * GET /cp/portals/by-portal-id/:portalId
   */
  app.get<{ Params: { portalId: string } }>('/by-portal-id/:portalId', async (request, reply) => {
    const portal = await portalRepo.findByPortalId(request.tenantId, request.params.portalId);

    if (!portal) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'PORTAL_NOT_FOUND',
          message: `Portal '${request.params.portalId}' not found`,
        },
      });
    }

    if (!portal.enabled) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'PORTAL_DISABLED',
          message: `Portal '${request.params.portalId}' is disabled. Enable it in Admin → Portals to process jobs.`,
        },
      });
    }

    return {
      success: true,
      data: portal,
    };
  });

  /**
   * List portals for tenant
   * GET /cp/portals
   */
  app.get<{
    Querystring: { enabled?: string; limit?: string; offset?: string };
  }>('/', async (request) => {
    const options: { enabled?: boolean; limit?: number; offset?: number } = {
      limit: Math.min(parseInt(request.query.limit ?? '100', 10), 500),
      offset: parseInt(request.query.offset ?? '0', 10),
    };

    if (request.query.enabled !== undefined) {
      options.enabled = request.query.enabled === 'true';
    }

    const portals = await portalRepo.findByTenantId(request.tenantId, options);

    // Get agent counts for each portal
    const portalsWithCounts = await Promise.all(
      portals.map(async (portal) => {
        const agentIds = await portalRepo.getAssignedAgentIds(request.tenantId, portal.portal_id);
        return {
          ...portal,
          assigned_agent_count: agentIds.length,
        };
      })
    );

    return {
      success: true,
      data: {
        items: portalsWithCounts,
        total: portals.length,
      },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    };
  });

  /**
   * Get portal by ID
   * GET /cp/portals/:id
   */
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const portal = await portalRepo.findById(request.tenantId, request.params.id);

    if (!portal) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'PORTAL_NOT_FOUND',
          message: `Portal with ID '${request.params.id}' not found`,
        },
      });
    }

    const agentIds = await portalRepo.getAssignedAgentIds(request.tenantId, portal.portal_id);
    const agents = await Promise.all(
      agentIds.map(id => agentRepo.findById(request.tenantId, id))
    );

    return {
      success: true,
      data: {
        ...portal,
        assigned_agents: agents.filter(Boolean),
      },
    };
  });

  /**
   * Create portal config
   * POST /cp/portals
   */
  app.post<{ Body: CreatePortalConfigRequest }>('/', async (request, reply) => {
    const { portal_id, name, base_url, enabled, config, selectors } = request.body;

    if (!portal_id) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_REQUIRED_FIELD',
          message: 'portal_id is required',
        },
      });
    }

    if (!name) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_REQUIRED_FIELD',
          message: 'name is required',
        },
      });
    }

    if (!base_url || typeof base_url !== 'string' || !base_url.trim()) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_REQUIRED_FIELD',
          message: 'base_url is required (DP reads portal config from CP only)',
        },
      });
    }

    if (config === undefined || config === null || typeof config !== 'object' || Array.isArray(config)) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_REQUIRED_FIELD',
          message: 'config is required (object with timeouts, pacing, rateLimit, hitl, selectorsVersion)',
        },
      });
    }

    try {
      validatePortalConfig(config);
      validatePortalSelectors(selectors);
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: err instanceof Error ? err.message : 'Invalid portal config or selectors',
        },
      });
    }

    // Check if portal already exists
    const existing = await portalRepo.findByPortalId(request.tenantId, portal_id);
    if (existing) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'PORTAL_ALREADY_EXISTS',
          message: `Portal '${portal_id}' already exists`,
        },
      });
    }

    const portal = await portalRepo.create({
      tenant_id: request.tenantId,
      portal_id,
      name,
      base_url: base_url.trim(),
      enabled: enabled ?? true,
      config: config as Record<string, unknown>,
      selectors: (selectors ?? {}) as Record<string, unknown>,
    });

    return reply.status(201).send({
      success: true,
      data: portal,
    });
  });

  /**
   * Update portal config
   * PATCH /cp/portals/:id
   */
  app.patch<{ Params: { id: string }; Body: UpdatePortalConfigRequest }>('/:id', async (request, reply) => {
    const portal = await portalRepo.findById(request.tenantId, request.params.id);

    if (!portal) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'PORTAL_NOT_FOUND',
          message: `Portal with ID '${request.params.id}' not found`,
        },
      });
    }

    const { name, base_url, enabled, config, selectors } = request.body;
    try {
      if (config !== undefined) validatePortalConfig(config);
      if (selectors !== undefined) validatePortalSelectors(selectors);
    } catch (err) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: err instanceof Error ? err.message : 'Invalid portal config or selectors',
        },
      });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (base_url !== undefined) updates.base_url = base_url;
    if (enabled !== undefined) updates.enabled = enabled;
    if (config !== undefined) updates.config = config;
    if (selectors !== undefined) updates.selectors = selectors;

    const updated = await portalRepo.update(request.tenantId, request.params.id, updates);

    return {
      success: true,
      data: updated,
    };
  });

  /**
   * Delete portal config
   * DELETE /cp/portals/:id
   */
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const portal = await portalRepo.findById(request.tenantId, request.params.id);

    if (!portal) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'PORTAL_NOT_FOUND',
          message: `Portal with ID '${request.params.id}' not found`,
        },
      });
    }

    await portalRepo.delete(request.tenantId, request.params.id);

    return {
      success: true,
      data: { deleted: true },
    };
  });

  /**
   * Assign agents to portal
   * POST /cp/portals/:id/assign-agents
   */
  app.post<{ Params: { id: string }; Body: AssignAgentsToPortalRequest }>('/:id/assign-agents', async (request, reply) => {
    const portal = await portalRepo.findById(request.tenantId, request.params.id);

    if (!portal) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'PORTAL_NOT_FOUND',
          message: `Portal with ID '${request.params.id}' not found`,
        },
      });
    }

    const { agent_ids } = request.body;
    const previouslyAssigned = await portalRepo.getAssignedAgentIds(request.tenantId, portal.portal_id);

    // Update each agent's desired_portals
    for (const agentId of agent_ids) {
      const agent = await agentRepo.findById(request.tenantId, agentId);
      if (agent) {
        const portals = new Set(agent.desired_portals);
        portals.add(portal.portal_id);
        await agentRepo.assignPortals(request.tenantId, agentId, Array.from(portals));
      }
    }

    return {
      success: true,
      data: {
        portal_id: portal.portal_id,
        assigned_agents: agent_ids,
        previously_assigned: previouslyAssigned,
      },
    };
  });

  /**
   * Enable portal
   * POST /cp/portals/:id/enable
   */
  app.post<{ Params: { id: string } }>('/:id/enable', async (request, reply) => {
    const portal = await portalRepo.findById(request.tenantId, request.params.id);

    if (!portal) {
      return reply.status(404).send({
        success: false,
        error: { code: 'PORTAL_NOT_FOUND', message: 'Portal not found' },
      });
    }

    const updated = await portalRepo.setEnabled(request.tenantId, request.params.id, true);
    return { success: true, data: updated };
  });

  /**
   * Disable portal
   * POST /cp/portals/:id/disable
   */
  app.post<{ Params: { id: string } }>('/:id/disable', async (request, reply) => {
    const portal = await portalRepo.findById(request.tenantId, request.params.id);

    if (!portal) {
      return reply.status(404).send({
        success: false,
        error: { code: 'PORTAL_NOT_FOUND', message: 'Portal not found' },
      });
    }

    const updated = await portalRepo.setEnabled(request.tenantId, request.params.id, false);
    return { success: true, data: updated };
  });
};
