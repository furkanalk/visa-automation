import type { FastifyPluginAsync } from 'fastify';
import { getDb, AuditRepository, SystemSettingsRepository } from '@visa-automation/db';
import type { ActorType } from '@visa-automation/shared';

export const auditRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const auditRepo = new AuditRepository(db);
  const settingsRepo = new SystemSettingsRepository(db);

  // ========================================
  // IMPORTANT: Static routes MUST be defined before /:id
  // Otherwise Fastify will match /summary, /recent, /export as IDs
  // ========================================

  /**
   * Get audit summary
   * GET /cp/audit/summary
   */
  app.get<{
    Querystring: { from?: string; to?: string };
  }>('/summary', async (request) => {
    const from = request.query.from ? new Date(request.query.from) : undefined;
    const to = request.query.to ? new Date(request.query.to) : undefined;

    const summary = await auditRepo.getSummary(request.tenantId, from, to);

    return {
      success: true,
      data: summary,
    };
  });

  /**
   * Get recent activity
   * GET /cp/audit/recent
   */
  app.get<{ Querystring: { limit?: string } }>('/recent', async (request) => {
    const limit = Math.min(parseInt(request.query.limit ?? '20', 10), 100);

    const logs = await auditRepo.findByTenantId(request.tenantId, { limit });

    // Format for activity feed
    const activities = logs.map(log => ({
      id: log.id,
      action: log.action,
      resource_type: log.resource_type,
      resource_id: log.resource_id,
      actor: {
        type: log.actor_type,
        id: log.actor_id,
        name: log.actor_name,
      },
      timestamp: log.created_at,
      summary: formatActivitySummary(log),
    }));

    return {
      success: true,
      data: {
        items: activities,
      },
    };
  });

  /**
   * Export audit logs (CSV format)
   * GET /cp/audit/export
   */
  app.get<{
    Querystring: {
      from?: string;
      to?: string;
      format?: string;
    };
  }>('/export', async (request, reply) => {
    const from = request.query.from ? new Date(request.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
    const to = request.query.to ? new Date(request.query.to) : new Date();
    const format = request.query.format ?? 'csv';

    if (format !== 'csv' && format !== 'json') {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_FORMAT',
          message: 'Format must be csv or json',
        },
      });
    }

    const exportMaxLimit = await settingsRepo.getNumber(null, 'audit', 'export_max_limit', 10_000);
    const logs = await auditRepo.findByTenantId(request.tenantId, {
      from,
      to,
      limit: exportMaxLimit,
    });

    if (format === 'json') {
      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="audit-logs-${request.tenantId}.json"`)
        .send(logs);
    }

    // CSV format
    const headers = ['id', 'timestamp', 'action', 'resource_type', 'resource_id', 'actor_type', 'actor_id', 'actor_name', 'ip_address'];
    const csvRows = [
      headers.join(','),
      ...logs.map(log => [
        log.id,
        log.created_at.toISOString(),
        log.action,
        log.resource_type,
        log.resource_id ?? '',
        log.actor_type,
        log.actor_id ?? '',
        log.actor_name ?? '',
        log.ip_address ?? '',
      ].map(v => `"${v}"`).join(','))
    ];

    return reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="audit-logs-${request.tenantId}.csv"`)
      .send(csvRows.join('\n'));
  });

  /**
   * List audit logs for tenant
   * GET /cp/audit
   */
  app.get<{
    Querystring: {
      actor_type?: string;
      actor_id?: string;
      action?: string;
      resource_type?: string;
      resource_id?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>('/', async (request) => {
    const query: {
      actor_type?: ActorType;
      actor_id?: string;
      action?: string[];
      resource_type?: string;
      resource_id?: string;
      from?: Date;
      to?: Date;
      limit?: number;
      offset?: number;
    } = {
      limit: Math.min(parseInt(request.query.limit ?? '100', 10), 500),
      offset: parseInt(request.query.offset ?? '0', 10),
    };

    if (request.query.actor_type) query.actor_type = request.query.actor_type as ActorType;
    if (request.query.actor_id) query.actor_id = request.query.actor_id;
    if (request.query.action) query.action = request.query.action.split(',');
    if (request.query.resource_type) query.resource_type = request.query.resource_type;
    if (request.query.resource_id) query.resource_id = request.query.resource_id;
    if (request.query.from) query.from = new Date(request.query.from);
    if (request.query.to) query.to = new Date(request.query.to);

    const logs = await auditRepo.findByTenantId(request.tenantId, query);

    return {
      success: true,
      data: {
        items: logs,
        total: logs.length,
      },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    };
  });

  /**
   * Get audit log by ID (MUST be after static routes!)
   * GET /cp/audit/:id
   */
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const log = await auditRepo.findById(request.params.id);

    if (!log) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'AUDIT_LOG_NOT_FOUND',
          message: `Audit log with ID '${request.params.id}' not found`,
        },
      });
    }

    if (log.tenant_id !== request.tenantId) {
      return reply.status(403).send({
        success: false,
        error: {
          code: 'AUTH_TENANT_MISMATCH',
          message: 'Access denied',
        },
      });
    }

    return {
      success: true,
      data: log,
    };
  });
};

/**
 * Format audit log into human-readable activity summary
 */
function formatActivitySummary(log: {
  action: string;
  resource_type: string;
  resource_id?: string | null;
  actor_name?: string | null;
  actor_type: string;
}): string {
  const actor = log.actor_name ?? log.actor_type;
  const resource = log.resource_id ? `${log.resource_type} ${log.resource_id}` : log.resource_type;

  const actionMap: Record<string, string> = {
    'agent.create': `${actor} created ${resource}`,
    'agent.update': `${actor} updated ${resource}`,
    'agent.delete': `${actor} deleted ${resource}`,
    'agent.enable': `${actor} enabled ${resource}`,
    'agent.disable': `${actor} disabled ${resource}`,
    'agent.heartbeat': `${actor} sent heartbeat`,
    'agent.bulk_assign_profile': `${actor} bulk-assigned profile`,
    'profile.create': `${actor} created ${resource}`,
    'profile.update': `${actor} updated ${resource}`,
    'profile.delete': `${actor} deleted ${resource}`,
    'portal.create': `${actor} created ${resource}`,
    'portal.update': `${actor} updated ${resource}`,
    'portal.enable': `${actor} enabled ${resource}`,
    'portal.disable': `${actor} disabled ${resource}`,
    'notify.update': `${actor} updated notification settings`,
    'notify.test_telegram': `${actor} tested Telegram notification`,
    'notify.test_email': `${actor} tested email notification`,
    'notify.test_webhook': `${actor} tested webhook`,
    'watcher.update': `${actor} updated watcher configuration`,
    'watcher.run_now': `${actor} triggered watcher run`,
  };

  return actionMap[log.action] ?? `${actor} performed ${log.action} on ${resource}`;
}
