import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getDb, SystemSettingsRepository } from '@visa-automation/db';
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

    const jobTotal = Object.values(jobsByStatus).reduce((a, b) => a + b, 0);
    const agentTotal = Object.values(agentsByStatus).reduce((a, b) => a + b, 0);
    const terminalJobStates = ['COMPLETED', 'FAILED_TERMINAL', 'CANCELLED'];
    const activeJobs = Object.entries(jobsByStatus).reduce(
      (sum, [status, count]) => (terminalJobStates.includes(status) ? sum : sum + count),
      0
    );
    const version = process.env.APP_VERSION ?? '1.0.0';

    return {
      success: true,
      data: {
        // Admin-portal dashboard shape
        version,
        uptime_seconds: process.uptime(),
        tenant_count: tenants.length,
        job_stats: { total: jobTotal, active: activeJobs, completed: jobsByStatus['COMPLETED'] ?? 0 },
        agent_stats: {
          total: agentTotal,
          online: agentsByStatus['ONLINE'] ?? 0,
          offline: agentTotal - (agentsByStatus['ONLINE'] ?? 0),
        },
        // Detailed (for future use)
        system: {
          status: 'operational',
          mode: process.env.SYSTEM_MODE ?? 'NORMAL',
          version,
        },
        tenants: { active: tenants.length },
        jobs: { by_status: jobsByStatus, total: jobTotal },
        agents: {
          by_status: agentsByStatus,
          total: agentTotal,
          online: agentsByStatus['ONLINE'] ?? 0,
        },
        timestamp: new Date().toISOString(),
      },
    };
  });

  /**
   * Get system configuration from Postgres (system_settings). No env fallback.
   * GET /cp/system/config
   * Requires: super_admin role
   */
  app.get('/config', async (request, reply) => {
    const db = getDb();
    const settingsRepo = new SystemSettingsRepository(db);
    const all = await settingsRepo.getAllGrouped(null);

    const system = (all.system ?? {}) as Record<string, number | string>;
    const features = (all.features ?? {}) as Record<string, boolean>;

    if (!system || Object.keys(system).length === 0) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'CONFIG_NOT_READY',
          message: 'system_settings not populated. Run migrations (010_system_settings).',
        },
      });
    }

    const num = (v: unknown, d: number) =>
      v !== undefined && v !== null ? (typeof v === 'number' ? v : parseInt(String(v), 10) || d) : d;
    const bool = (v: unknown, d: boolean) =>
      v !== undefined && v !== null ? (typeof v === 'boolean' ? v : String(v) === 'true') : d;

    return {
      success: true,
      data: {
        features: {
          watcher_enabled: bool(features.watcher_enabled, true),
          hitl_enabled: bool(features.hitl_enabled, true),
          notifications_enabled: bool(features.notifications_enabled, true),
        },
        limits: {
          max_agents_per_tenant: num(system.max_agents_per_worker ?? system.max_agents_per_tenant, 100),
          max_concurrent_jobs: num(system.max_concurrent_jobs, 50),
          heartbeat_interval_ms: num(system.heartbeat_interval_ms, 10000),
          heartbeat_timeout_ms: num(system.heartbeat_timeout_ms, 30000),
        },
        defaults: {
          agent_mode: (system.default_agent_mode as string) ?? 'ASYNC',
          profile_pacing_min_ms: num(system.profile_pacing_min_ms, 800),
          profile_pacing_max_ms: num(system.profile_pacing_max_ms, 2000),
        },
      },
    };
  });
};
