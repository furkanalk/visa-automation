import type { FastifyBaseLogger } from 'fastify';
import { getDb, WatcherRepository, PortalConfigRepository, CustomerRepository, ProfileRepository, AgentRepository } from '@visa-automation/db';
import { getLivenessForTenant } from '../services/portal-liveness.js';
import { JobService } from '../services/job.service.js';
import { capturePortalSnapshot } from '../services/snapshot-capture.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let timeoutId: ReturnType<typeof setTimeout> | null = null;

export type GetNextWatcherDelayMs = () => Promise<number>;

/**
 * Run watcher logic for a single tenant: liveness check then create slot-check jobs for active customers.
 * Used by the worker (all tenants) and by POST /cp/watcher/run-now (one tenant).
 */
export interface WatcherRunResult {
  jobsCreated: number;
  /** Job IDs of created slot-check (scout) jobs. */
  createdJobIds: string[];
  /** Portal IDs that were up (liveness passed). */
  upPortalIds: string[];
  /** Portal IDs that were down (liveness failed). */
  downPortalIds: string[];
  /** Among up portals, those with zero active customers (bookings). */
  upPortalsWithNoCustomers: string[];
}

export async function runWatcherForTenant(
  logger: FastifyBaseLogger,
  tenantId: string,
  portalIds: string[],
  triggeredBy: 'manual' | 'watcher_auto' = 'watcher_auto',
  triggeredByName?: string,
): Promise<WatcherRunResult> {
  const db = getDb();
  const watcherRepo = new WatcherRepository(db);
  const portalRepo = new PortalConfigRepository(db);
  const customerRepo = new CustomerRepository(db);
  const profileRepo = new ProfileRepository(db);
  const jobService = new JobService();

  const scoutProfile = await profileRepo.findScout(tenantId);
  const rawSlotCheck = (scoutProfile?.config as Record<string, unknown> | undefined)?.slot_check_only;
  const slotCheckOnly: boolean = rawSlotCheck === false ? false : true;

  const empty: WatcherRunResult = { jobsCreated: 0, createdJobIds: [], upPortalIds: [], downPortalIds: [], upPortalsWithNoCustomers: [] };

  if (portalIds.length === 0) {
    const enabled = await portalRepo.findByTenantId(tenantId, { enabled: true });
    portalIds = enabled.map((p) => p.portal_id);
  }
  if (portalIds.length === 0) return empty;

  const { items: livenessItems } = await getLivenessForTenant(tenantId, { portalIds, logger });
  const upPortalIds = livenessItems.filter((i) => i.status === 'up').map((i) => i.portal_id);
  const downPortalIds = livenessItems.filter((i) => i.status === 'down').map((i) => i.portal_id);
  if (downPortalIds.length > 0) {
    logger.info({ tenantId, down: downPortalIds }, 'Watcher: some portals down, skipping slot hunt for those');
  }

  const upPortalsWithNoCustomers: string[] = [];
  const createdJobIds: string[] = [];
  let jobsCreated = 0;
  for (const portalId of upPortalIds) {
    const { items: customers } = await customerRepo.findWithFilters({
      tenantId,
      status: 'active',
      portalId,
      limit: 500,
    });
    if (customers.length === 0) {
      upPortalsWithNoCustomers.push(portalId);
      continue;
    }

    try {
      const jobConfig = {
        slot_check_only: slotCheckOnly,
        triggered_by: triggeredBy,
        ...(triggeredByName ? { triggered_by_name: triggeredByName } : {}),
      };
      const { job_id } = await jobService.createJob({
        tenant_id: tenantId,
        portal_id: portalId,
        visa_type: 'SCHENGEN',
        priority: 5,
        applicant: {} as import('@visa-automation/shared').ApplicantData,
        config: jobConfig,
      });
      createdJobIds.push(job_id);
      jobsCreated++;
    } catch (err) {
      logger.warn({ err, portalId }, 'Watcher: failed to create slot-check job');
    }
  }

  if (jobsCreated > 0) {
    logger.info({ tenantId, jobsCreated, createdJobIds, portalsChecked: portalIds.length }, 'Watcher: slot-check (scout) jobs created');
  }

  // HTML snapshot/diff per portal: only when interval elapsed (configurable: every run, 1h, 3h, 12h, 1d, 1w)
  const config = await watcherRepo.findConfigByTenantId(tenantId);
  const intervalRaw = config?.html_diff_interval ?? '1d';
  const intervalMs = intervalRaw === 'every_run' ? 0
    : intervalRaw === '1h' ? 3600 * 1000
    : intervalRaw === '3h' ? 3 * 3600 * 1000
    : intervalRaw === '12h' ? 12 * 3600 * 1000
    : intervalRaw === '1d' ? 24 * 3600 * 1000
    : intervalRaw === '1w' ? 7 * 24 * 3600 * 1000
    : 24 * 3600 * 1000;
  const lastDiff = config?.last_html_diff_at ? new Date(config.last_html_diff_at).getTime() : 0;
  const shouldRunHtmlDiff = intervalMs === 0 || lastDiff === 0 || (Date.now() - lastDiff >= intervalMs);

  if (shouldRunHtmlDiff && upPortalIds.length > 0) {
    for (const portalId of upPortalIds) {
      const portalConfig = await portalRepo.findByPortalId(tenantId, portalId);
      const baseUrl = portalConfig?.base_url ?? null;
      if (baseUrl) {
        try {
          await capturePortalSnapshot(logger, tenantId, portalId, baseUrl, { notifyTarget: 'watcher' });
        } catch (err) {
          logger.warn({ err, portalId }, 'Watcher: snapshot capture failed');
        }
      }
    }
    await watcherRepo.updateConfig(tenantId, { last_html_diff_at: new Date() });
  }

  await watcherRepo.updateConfig(tenantId, { last_run_at: new Date() });
  return { jobsCreated, createdJobIds, upPortalIds, downPortalIds, upPortalsWithNoCustomers };
}

/**
 * Watcher worker: on a schedule (fixed or random interval from system_settings),
 * 1) Run liveness check for each tenant's watcher portals.
 * 2) For portals that are up, create a slot-check job per active customer (only when there are customers).
 * Uses setTimeout so the next run delay can be random (e.g. 3–10 min).
 * Call the returned stop() on shutdown.
 */
export function startWatcherWorker(
  logger: FastifyBaseLogger,
  getNextDelayMs: GetNextWatcherDelayMs
): () => void {
  if (timeoutId) {
    logger.warn('Watcher worker already running');
    return () => {};
  }

  const db = getDb();
  const watcherRepo = new WatcherRepository(db);
  const portalRepo = new PortalConfigRepository(db);

  const scheduleNext = () => {
    getNextDelayMs().then((delayMs) => {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        run().finally(scheduleNext);
      }, delayMs);
      logger.debug({ delayMs, nextRunInMin: Math.round(delayMs / 60000) }, 'Watcher next run scheduled');
    }).catch((err) => {
      logger.error({ err }, 'Watcher getNextDelayMs failed; rescheduling in 5 min');
      timeoutId = setTimeout(() => {
        timeoutId = null;
        run().finally(scheduleNext);
      }, DEFAULT_INTERVAL_MS);
    });
  };

  /** True if current hour (server local) is inside [start, end]; supports overnight (e.g. 22–02). */
  const isWithinWindow = (start: number, end: number): boolean => {
    const hour = new Date().getHours();
    if (start <= end) return hour >= start && hour <= end;
    return hour >= start || hour <= end;
  };

  const run = async () => {
    try {
      const configs = await watcherRepo.findEnabledConfigs();
      if (configs.length === 0) return;

      const profileRepo = new ProfileRepository(getDb());
      const agentRepo = new AgentRepository(getDb());

      for (const config of configs) {
        const tenantId = config.tenant_id;
        const scoutProfileIds = await profileRepo.findScoutProfileIds(tenantId);
        const scoutAgents = await agentRepo.findByTenantId(tenantId, {
          profile_ids: scoutProfileIds,
          status: 'ONLINE',
          limit: 1,
        });
        if (scoutProfileIds.length === 0 || scoutAgents.length === 0) {
          logger.debug({ tenantId }, 'Watcher: no online Scout agent for tenant, skipping');
          if (config.enabled) {
            await watcherRepo.upsertConfig(tenantId, { enabled: false });
          }
          continue;
        }
        if (config.time_window_enabled && !isWithinWindow(config.window_start_hour, config.window_end_hour)) {
          logger.debug({ tenantId, window: [config.window_start_hour, config.window_end_hour] }, 'Watcher: outside time window, skipping');
          continue;
        }
        const portalIds = config.portals && config.portals.length > 0
          ? config.portals
          : (await portalRepo.findByTenantId(tenantId, { enabled: true })).map((p) => p.portal_id);
        if (portalIds.length === 0) continue;
        const result = await runWatcherForTenant(logger, tenantId, portalIds);
        const message = result.jobsCreated > 0
          ? `Created ${result.jobsCreated} slot-check (scout) job(s).${result.createdJobIds.length > 0 ? ` Job(s): ${result.createdJobIds.join(', ')}.` : ''}`
          : (result.upPortalIds.length === 0
            ? 'All portals down.'
            : result.upPortalsWithNoCustomers.length === result.upPortalIds.length
              ? 'No active customers for checked portals.'
              : 'No slot-check jobs created.');
        await watcherRepo.createRunHistory(tenantId, {
          portals_checked: portalIds,
          jobs_created: result.jobsCreated,
          up_portal_ids: result.upPortalIds,
          down_portal_ids: result.downPortalIds,
          up_portals_with_no_customers: result.upPortalsWithNoCustomers,
          message,
        });
        // Telegram: Watcher channel only gets SLOT OPEN and HTML Drift (no slot-check jobs created)
        const snapshotRetentionDays = config.snapshot_retention_days ?? 7;
        const runRetentionDays = config.run_retention_days ?? 7;
        const snapshotOlderThan = new Date(Date.now() - snapshotRetentionDays * 24 * 60 * 60 * 1000);
        const runOlderThan = new Date(Date.now() - runRetentionDays * 24 * 60 * 60 * 1000);
        const deleted = await watcherRepo.deleteOldSnapshots(tenantId, snapshotOlderThan);
        if (deleted > 0) logger.info({ tenantId, deleted, days: snapshotRetentionDays }, 'Watcher: pruned old snapshots');
        const deletedRuns = await watcherRepo.deleteOldRunHistory(tenantId, runOlderThan);
        if (deletedRuns > 0) logger.info({ tenantId, deletedRuns, days: runRetentionDays }, 'Watcher: pruned old run history');
      }
    } catch (err) {
      logger.error({ err }, 'Watcher worker run failed');
    }
  };

  run().finally(scheduleNext);
  logger.info('Watcher worker started (liveness then slot hunt; interval from system_settings)');

  return function stop() {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      logger.info('Watcher worker stopped');
    }
  };
}
