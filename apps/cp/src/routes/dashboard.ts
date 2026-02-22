import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '@visa-automation/db';
import { sql } from 'kysely';
import { getLivenessForTenant } from '../services/portal-liveness.js';

const RECORD_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const RETENTION_DAYS = 7;

async function requireSuperAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const roles = (request.headers['x-roles'] as string)?.split(',').map((r) => r.trim()) ?? [];
  if (!roles.includes('super_admin')) {
    return reply.status(403).send({
      success: false,
      error: {
        code: 'AUTH_SUPER_ADMIN_REQUIRED',
        message: 'Access denied: super_admin role required for dashboard',
      },
    });
  }
}

async function recordSnapshot(): Promise<void> {
  const db = getDb();
  try {
    const [jobs, agents] = await Promise.all([
      db
        .selectFrom('jobs')
        .select(['status', sql<number>`count(*)::int`.as('count')])
        .groupBy('status')
        .execute(),
      db
        .selectFrom('agents')
        .select(['status', sql<number>`count(*)::int`.as('count')])
        .groupBy('status')
        .execute(),
    ]);

    const jobsByStatus: Record<string, number> = {};
    for (const row of jobs) jobsByStatus[row.status] = row.count;
    const agentsByStatus: Record<string, number> = {};
    for (const row of agents) agentsByStatus[row.status] = row.count;

    const jobTotal = Object.values(jobsByStatus).reduce((a, b) => a + b, 0);
    const agentTotal = Object.values(agentsByStatus).reduce((a, b) => a + b, 0);
    const terminalJobStates = ['COMPLETED', 'FAILED_TERMINAL', 'CANCELLED'];
    const activeJobs = Object.entries(jobsByStatus).reduce(
      (sum, [status, count]) => (terminalJobStates.includes(status) ? sum : sum + count),
      0
    );
    const onlineAgents = agentsByStatus['ONLINE'] ?? 0;
    const completedJobs = jobsByStatus['COMPLETED'] ?? 0;
    const failedJobs = (jobsByStatus['FAILED_TERMINAL'] ?? 0) + (jobsByStatus['FAILED_RETRYABLE'] ?? 0);
    const cancelledJobs = jobsByStatus['CANCELLED'] ?? 0;

    let portalUp = 0;
    let portalDown = 0;
    try {
      const tenantRows = await db
        .selectFrom('tenants')
        .select('id')
        .where('status', '=', 'ACTIVE')
        .execute();
      for (const row of tenantRows) {
        const { items } = await getLivenessForTenant(row.id);
        for (const item of items) {
          if (item.status === 'up') portalUp += 1;
          else portalDown += 1;
        }
      }
    } catch (e) {
      console.error('Portal liveness in snapshot failed:', e);
    }

    await db
      .insertInto('dashboard_snapshots')
      .values({
        recorded_at: new Date(),
        online_agents: onlineAgents,
        total_agents: agentTotal,
        active_jobs: activeJobs,
        total_jobs: jobTotal,
        completed_jobs: completedJobs,
        failed_jobs: failedJobs,
        cancelled_jobs: cancelledJobs,
        portal_up_count: portalUp,
        portal_down_count: portalDown,
      })
      .execute();

    await db
      .deleteFrom('dashboard_snapshots')
      .where(sql<boolean>`recorded_at < now() - interval '${sql.raw(String(RETENTION_DAYS))} days'`)
      .execute();
  } catch (err) {
    // Log but don't throw; next tick will retry
    console.error('Dashboard snapshot record failed:', err);
  }
}

export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireSuperAdmin);

  let intervalId: ReturnType<typeof setInterval> | null = null;

  app.addHook('onReady', async () => {
    await recordSnapshot();
    intervalId = setInterval(recordSnapshot, RECORD_INTERVAL_MS);
  });

  app.addHook('onClose', async () => {
    if (intervalId) clearInterval(intervalId);
  });

  /**
   * GET /cp/dashboard/history?period=24h|3d|7d
   * Returns time-series for dashboard graph. Scale is driven by period.
   */
  app.get<{ Querystring: { period?: string } }>('/history', async (request, reply) => {
    const period = (request.query.period ?? '7d').toLowerCase();
    const db = getDb();

    let from: Date;
    if (period === '24h') from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    else if (period === '3d') from = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    else from = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const rows = await db
      .selectFrom('dashboard_snapshots')
      .select([
        'recorded_at',
        'online_agents',
        'total_agents',
        'active_jobs',
        'total_jobs',
        'completed_jobs',
        'failed_jobs',
        'cancelled_jobs',
        'portal_up_count',
        'portal_down_count',
      ])
      .where('recorded_at', '>=', from)
      .orderBy('recorded_at', 'asc')
      .execute();

    return reply.send({
      success: true,
      data: {
        period,
        points: rows.map((r) => ({
          timestamp: r.recorded_at instanceof Date ? r.recorded_at.toISOString() : r.recorded_at,
          online_agents: r.online_agents,
          total_agents: r.total_agents,
          active_jobs: r.active_jobs,
          total_jobs: r.total_jobs,
          completed_jobs: r.completed_jobs,
          failed_jobs: r.failed_jobs ?? 0,
          cancelled_jobs: r.cancelled_jobs ?? 0,
          portal_up_count: r.portal_up_count ?? 0,
          portal_down_count: r.portal_down_count ?? 0,
        })),
      },
    });
  });
};
