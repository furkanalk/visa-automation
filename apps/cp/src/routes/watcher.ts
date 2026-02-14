import type { FastifyPluginAsync } from 'fastify';
import { getDb, WatcherRepository, PortalConfigRepository } from '@visa-automation/db';
import type {
  UpdateWatcherConfigRequest,
  WatcherRunNowRequest,
  DiffSeverity,
} from '@visa-automation/shared';

interface SnapshotParams {
  id: string;
}

export const watcherRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const watcherRepo = new WatcherRepository(db);
  const portalRepo = new PortalConfigRepository(db);

  /**
   * Get watcher configuration
   * GET /cp/watcher
   */
  app.get('/', async (request) => {
    let config = await watcherRepo.findConfigByTenantId(request.tenantId);

    // Create default config if not exists
    if (!config) {
      config = await watcherRepo.createConfig({
        tenant_id: request.tenantId,
      });
    }

    return {
      success: true,
      data: {
        config,
        status: config.enabled ? 'enabled' : 'disabled',
      },
      meta: {
        request_id: request.id,
        timestamp: new Date().toISOString(),
      },
    };
  });

  /**
   * Update watcher configuration
   * PATCH /cp/watcher
   */
  app.patch<{ Body: UpdateWatcherConfigRequest }>('/', async (request) => {
    const body = request.body;
    const updates: Record<string, unknown> = {};

    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.window_start_hour !== undefined) updates.window_start_hour = body.window_start_hour;
    if (body.window_end_hour !== undefined) updates.window_end_hour = body.window_end_hour;
    if (body.jitter_minutes !== undefined) updates.jitter_minutes = body.jitter_minutes;
    if (body.portals !== undefined) updates.portals = body.portals;
    if (body.notify_on_change !== undefined) updates.notify_on_change = body.notify_on_change;

    const config = await watcherRepo.upsertConfig(request.tenantId, updates);

    return {
      success: true,
      data: config,
    };
  });

  /**
   * Trigger watcher run now
   * POST /cp/watcher/run-now
   */
  app.post<{ Body: WatcherRunNowRequest }>('/run-now', async (request, reply) => {
    const config = await watcherRepo.findConfigByTenantId(request.tenantId);

    if (!config) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'WATCHER_NOT_CONFIGURED',
          message: 'Watcher is not configured for this tenant',
        },
      });
    }

    const { portal_ids, force: _force } = request.body;

    // Determine which portals to check
    let portalsToCheck = portal_ids ?? config.portals;

    if (!portalsToCheck || portalsToCheck.length === 0) {
      // Get all enabled portals
      const enabledPortals = await portalRepo.findByTenantId(request.tenantId, { enabled: true });
      portalsToCheck = enabledPortals.map(p => p.portal_id);
    }

    if (portalsToCheck.length === 0) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'NO_PORTALS',
          message: 'No portals to watch',
        },
      });
    }

    // In MVP, we just record that a run was requested
    // The actual watcher worker would pick this up
    await watcherRepo.updateConfig(request.tenantId, {
      last_run_at: new Date(),
    });

    return {
      success: true,
      data: {
        triggered: true,
        portals: portalsToCheck,
        message: 'Watcher run triggered. Results will be available in snapshots.',
        estimated_completion: new Date(Date.now() + portalsToCheck.length * 30000), // ~30s per portal
      },
    };
  });

  /**
   * List snapshots
   * GET /cp/watcher/snapshots
   */
  app.get<{
    Querystring: {
      portal_id?: string;
      from?: string;
      to?: string;
      severity?: string;
      limit?: string;
      offset?: string;
    };
  }>('/snapshots', async (request) => {
    const options: {
      portalId?: string;
      from?: Date;
      to?: Date;
      severity?: DiffSeverity[];
      limit?: number;
      offset?: number;
    } = {
      limit: Math.min(parseInt(request.query.limit ?? '50', 10), 200),
      offset: parseInt(request.query.offset ?? '0', 10),
    };

    if (request.query.portal_id) options.portalId = request.query.portal_id;
    if (request.query.from) options.from = new Date(request.query.from);
    if (request.query.to) options.to = new Date(request.query.to);
    if (request.query.severity) {
      options.severity = request.query.severity.split(',') as DiffSeverity[];
    }

    const snapshots = await watcherRepo.findSnapshots(request.tenantId, options);

    // Return metadata only, not full HTML
    const snapshotSummaries = snapshots.map(s => ({
      id: s.id,
      portal_id: s.portal_id,
      captured_at: s.captured_at,
      html_hash: s.html_hash,
      diff_severity: s.diff_severity,
      diff_summary: s.diff_summary,
      has_screenshot: !!s.screenshot_path,
      metadata: s.metadata,
    }));

    return {
      success: true,
      data: {
        items: snapshotSummaries,
        total: snapshots.length,
      },
    };
  });

  /**
   * Get snapshot by ID
   * GET /cp/watcher/snapshots/:id
   */
  app.get<{ Params: SnapshotParams }>('/snapshots/:id', async (request, reply) => {
    const snapshot = await watcherRepo.findSnapshotById(request.params.id);

    if (!snapshot) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'SNAPSHOT_NOT_FOUND',
          message: `Snapshot with ID '${request.params.id}' not found`,
        },
      });
    }

    if (snapshot.tenant_id !== request.tenantId) {
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
      data: snapshot,
    };
  });

  /**
   * Get snapshot HTML (raw)
   * GET /cp/watcher/snapshots/:id/html
   */
  app.get<{ Params: SnapshotParams }>('/snapshots/:id/html', async (request, reply) => {
    const snapshot = await watcherRepo.findSnapshotById(request.params.id);

    if (!snapshot || snapshot.tenant_id !== request.tenantId) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'SNAPSHOT_NOT_FOUND',
          message: 'Snapshot not found',
        },
      });
    }

    return reply
      .header('Content-Type', 'text/html')
      .send(snapshot.html);
  });

  /**
   * Get latest diff for portal
   * GET /cp/watcher/diffs/latest
   */
  app.get<{ Querystring: { portal_id: string } }>('/diffs/latest', async (request, reply) => {
    const { portal_id } = request.query;

    if (!portal_id) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_REQUIRED_FIELD',
          message: 'portal_id is required',
        },
      });
    }

    const latest = await watcherRepo.findLatestSnapshot(request.tenantId, portal_id);

    if (!latest) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NO_SNAPSHOTS',
          message: `No snapshots found for portal '${portal_id}'`,
        },
      });
    }

    // Get previous snapshot for comparison
    let previous = null;
    if (latest.previous_snapshot_id) {
      previous = await watcherRepo.findSnapshotById(latest.previous_snapshot_id);
    }

    return {
      success: true,
      data: {
        current: {
          id: latest.id,
          captured_at: latest.captured_at,
          html_hash: latest.html_hash,
          diff_severity: latest.diff_severity,
          diff_summary: latest.diff_summary,
        },
        previous: previous ? {
          id: previous.id,
          captured_at: previous.captured_at,
          html_hash: previous.html_hash,
        } : null,
        changed: latest.diff_severity !== 'none',
      },
    };
  });

  /**
   * Get watcher status
   * GET /cp/watcher/status
   */
  app.get('/status', async (request) => {
    const config = await watcherRepo.findConfigByTenantId(request.tenantId);

    if (!config) {
      return {
        success: true,
        data: {
          status: 'not_configured',
          config: null,
        },
      };
    }

    // Get recent results
    const recentSnapshots = await watcherRepo.findSnapshots(request.tenantId, { limit: 10 });

    const lastResults = recentSnapshots.map(s => ({
      portal_id: s.portal_id,
      snapshot_id: s.id,
      captured_at: s.captured_at,
      diff_severity: s.diff_severity ?? 'none',
      diff_summary: s.diff_summary,
      changed: s.diff_severity !== 'none' && s.diff_severity !== null,
    }));

    return {
      success: true,
      data: {
        config,
        status: config.enabled ? 'enabled' : 'disabled',
        last_results: lastResults,
      },
    };
  });
};
