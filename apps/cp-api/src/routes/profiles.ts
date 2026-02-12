import type { FastifyPluginAsync } from 'fastify';
import { getDb, ProfileRepository } from '@visa-automation/db';
import type { CreateProfileRequest, UpdateProfileRequest } from '@visa-automation/shared';

export const profileRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const profileRepo = new ProfileRepository(db);

  /**
   * Get default profile (MUST be before /:id to avoid route conflict)
   * GET /cp/profiles/default
   */
  app.get('/default', async (request, reply) => {
    const profile = await profileRepo.findDefault(request.tenantId);

    if (!profile) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NO_DEFAULT_PROFILE',
          message: 'No default profile configured for this tenant',
        },
      });
    }

    return {
      success: true,
      data: profile,
    };
  });

  /**
   * List profiles for tenant
   * GET /cp/profiles
   */
  app.get<{
    Querystring: { limit?: string; offset?: string };
  }>('/', async (request) => {
    const limit = Math.min(parseInt(request.query.limit ?? '100', 10), 500);
    const offset = parseInt(request.query.offset ?? '0', 10);

    const profiles = await profileRepo.findByTenantId(request.tenantId, limit, offset);

    // Get agent counts for each profile
    const profilesWithCounts = await Promise.all(
      profiles.map(async (profile) => {
        const agentCount = await profileRepo.countAgentsUsingProfile(request.tenantId, profile.id);
        return {
          ...profile,
          agent_count: agentCount,
        };
      })
    );

    return {
      success: true,
      data: {
        items: profilesWithCounts,
        total: profiles.length,
      },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    };
  });

  /**
   * Get profile by ID
   * GET /cp/profiles/:id
   */
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const profile = await profileRepo.findById(request.tenantId, request.params.id);

    if (!profile) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: `Profile with ID '${request.params.id}' not found`,
        },
      });
    }

    const agentCount = await profileRepo.countAgentsUsingProfile(request.tenantId, profile.id);

    return {
      success: true,
      data: {
        ...profile,
        agent_count: agentCount,
      },
    };
  });

  /**
   * Create profile
   * POST /cp/profiles
   */
  app.post<{ Body: CreateProfileRequest }>('/', async (request, reply) => {
    const { name, description, config, is_default } = request.body;

    if (!name) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_REQUIRED_FIELD',
          message: 'name is required',
        },
      });
    }

    if (!config || typeof config !== 'object') {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_REQUIRED_FIELD',
          message: 'config is required and must be an object',
        },
      });
    }

    const profile = await profileRepo.create({
      tenant_id: request.tenantId,
      name,
      description: description ?? null,
      config,
      is_default: is_default ?? false,
    });

    return reply.status(201).send({
      success: true,
      data: profile,
    });
  });

  /**
   * Update profile
   * PATCH /cp/profiles/:id
   */
  app.patch<{ Params: { id: string }; Body: UpdateProfileRequest }>('/:id', async (request, reply) => {
    const profile = await profileRepo.findById(request.tenantId, request.params.id);

    if (!profile) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: `Profile with ID '${request.params.id}' not found`,
        },
      });
    }

    const { name, description, config, is_default } = request.body;
    const updates: Record<string, unknown> = {};

    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (config !== undefined) updates.config = config;
    if (is_default !== undefined) updates.is_default = is_default;

    const updated = await profileRepo.update(request.tenantId, request.params.id, updates);

    return {
      success: true,
      data: updated,
    };
  });

  /**
   * Delete profile
   * DELETE /cp/profiles/:id
   */
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const profile = await profileRepo.findById(request.tenantId, request.params.id);

    if (!profile) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: `Profile with ID '${request.params.id}' not found`,
        },
      });
    }

    // Check if any agents are using this profile
    const agentCount = await profileRepo.countAgentsUsingProfile(request.tenantId, profile.id);
    if (agentCount > 0) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'PROFILE_IN_USE',
          message: `Cannot delete profile: ${agentCount} agent(s) are using it`,
        },
      });
    }

    // Don't allow deleting the default profile if it's the only one
    if (profile.is_default) {
      const allProfiles = await profileRepo.findByTenantId(request.tenantId);
      if (allProfiles.length === 1) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'CANNOT_DELETE_ONLY_DEFAULT',
            message: 'Cannot delete the only default profile',
          },
        });
      }
    }

    await profileRepo.delete(request.tenantId, request.params.id);

    return {
      success: true,
      data: { deleted: true },
    };
  });
};
