import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '@visa-automation/db';
import { sql } from 'kysely';

/**
 * Super admin check middleware
 * System routes expose cross-tenant data, require super_admin role
 */
async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Check for super admin header/token
  // In production this would validate JWT claims
  const roles = (request.headers['x-roles'] as string)?.split(',').map(r => r.trim()) ?? [];
  const isSuperAdmin = roles.includes('super_admin');

  if (!isSuperAdmin) {
    return reply.status(403).send({
      success: false,
      error: {
        code: 'AUTH_SUPER_ADMIN_REQUIRED',
        message: 'Access denied: super_admin role required for system endpoints',
      },
    });
  }
}

export const systemRoutes: FastifyPluginAsync = async (app) => {
  // Apply super admin check to all system routes
  app.addHook('preHandler', requireSuperAdmin);

  /**
   * System status - comprehensive system overview (cross-tenant)
   * GET /cp/system/status
   * Requires: super_admin role
   */
  app.get('/status', async () => {
    const db = getDb();

    // Get system-wide stats (across all tenants)
    const [tenants, jobs, agents] = await Promise.all([
      // Get active tenants
      db.selectFrom('tenants')
        .select('id')
        .where('status', '=', 'ACTIVE')
        .execute(),
      
      // Job statistics
      db.selectFrom('jobs')
        .select(['status', sql<number>`count(*)::int`.as('count')])
        .groupBy('status')
        .execute(),
      
      // Agent statistics
      db.selectFrom('agents')
        .select(['status', sql<number>`count(*)::int`.as('count')])
        .groupBy('status')
        .execute(),
    ]);

    // Format job stats
    const jobsByStatus: Record<string, number> = {};
    for (const row of jobs) {
      jobsByStatus[row.status] = row.count;
    }

    // Format agent stats
    const agentsByStatus: Record<string, number> = {};
    for (const row of agents) {
      agentsByStatus[row.status] = row.count;
    }

    return {
      success: true,
      data: {
        system: {
          status: 'operational',
          mode: process.env.SYSTEM_MODE ?? 'NORMAL',
          version: process.env.APP_VERSION ?? '1.0.0',
        },
        tenants: {
          active: tenants.length,
        },
        jobs: {
          by_status: jobsByStatus,
          total: Object.values(jobsByStatus).reduce((a, b) => a + b, 0),
        },
        agents: {
          by_status: agentsByStatus,
          total: Object.values(agentsByStatus).reduce((a, b) => a + b, 0),
          online: agentsByStatus['ONLINE'] ?? 0,
        },
        timestamp: new Date().toISOString(),
      },
    };
  });

  /**
   * Get system configuration (non-sensitive)
   * GET /cp/system/config
   * Requires: super_admin role
   */
  app.get('/config', async () => {
    return {
      success: true,
      data: {
        features: {
          watcher_enabled: process.env.WATCHER_ENABLED !== 'false',
          hitl_enabled: process.env.HITL_ENABLED !== 'false',
          notifications_enabled: process.env.NOTIFICATIONS_ENABLED !== 'false',
        },
        limits: {
          max_agents_per_tenant: parseInt(process.env.MAX_AGENTS_PER_TENANT ?? '100', 10),
          max_concurrent_jobs: parseInt(process.env.MAX_CONCURRENT_JOBS ?? '50', 10),
          heartbeat_interval_ms: parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? '10000', 10),
          heartbeat_timeout_ms: parseInt(process.env.HEARTBEAT_TIMEOUT_MS ?? '30000', 10),
        },
        defaults: {
          agent_mode: process.env.DEFAULT_AGENT_MODE ?? 'ASYNC',
          profile_pacing_min_ms: parseInt(process.env.DEFAULT_PACING_MIN_MS ?? '800', 10),
          profile_pacing_max_ms: parseInt(process.env.DEFAULT_PACING_MAX_MS ?? '2000', 10),
        },
      },
    };
  });
};
