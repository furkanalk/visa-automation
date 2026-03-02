import type { FastifyPluginAsync } from 'fastify';
import { getDb, WatcherRepository, PortalConfigRepository, SystemSettingsRepository, CustomerRepository, ProfileRepository, AgentRepository, JobRepository } from '@visa-automation/db';
import type {
  UpdateWatcherConfigRequest,
  WatcherRunNowRequest,
  DiffSeverity,
} from '@visa-automation/shared';
import type { ApplicantData } from '@visa-automation/shared';
import { runWatcherForTenant } from '../workers/watcher.js';
import { JobService } from '../services/job.service.js';
import { enqueueSyncJob } from '../queue/producer.js';

// ---------------------------------------------------------------------------
// Travel-date window helpers
// ---------------------------------------------------------------------------

/**
 * Parses a date string that may be:
 *   - ISO "YYYY-MM-DD"
 *   - DD/MM/YYYY (AS-VISA display format)
 *   - YYYY-M-D  (no leading zeros, /TarihGetir format)
 * Returns a UTC midnight Date or null if unparseable.
 */
function parseTravelDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(Date.UTC(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1])));
    return isNaN(d.getTime()) ? null : d;
  }
  // YYYY-MM-DD or YYYY-M-D
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const d = new Date(Date.UTC(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3])));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Returns the appointment window for a given travel date.
 * Default: [travelDate - 45 days, travelDate - 15 days]
 * Configurable via portal settings: appointmentWindowDays.maxBeforeTravel / minBeforeTravel
 * Both dates are UTC midnight.
 */
function appointmentWindow(travelDate: Date, windowDays?: { minBeforeTravel?: number; maxBeforeTravel?: number }): { start: Date; end: Date } {
  const maxBefore = Math.max(1, windowDays?.maxBeforeTravel ?? 45);
  const minBefore = Math.max(0, windowDays?.minBeforeTravel ?? 15);
  const start = new Date(travelDate);
  start.setUTCDate(start.getUTCDate() - maxBefore);
  const end = new Date(travelDate);
  end.setUTCDate(end.getUTCDate() - minBefore);
  return { start, end };
}

/**
 * Parse an open-date string from /TarihGetir (YYYY-M-D) to UTC midnight Date.
 * Same format as parseTravelDate YYYY-M-D branch.
 */
function parseOpenDate(raw: string): Date | null {
  return parseTravelDate(raw);
}

/**
 * Derive a single effective travel date from customer preferences.
 * travelDateMode: 'single' → travelDateSingle
 *                 'range'  → travelDateTo (farthest, gives the widest window)
 *                 'auto'   → no customer travel date, skip filtering
 * Returns null → no filtering for this customer (job is created anyway).
 */
/**
 * Check whether any open date from /TarihGetir falls within the customer's appointment window.
 * Returns true  → job should be created.
 * Returns false → no matching date, skip.
 *
 * Appointment window = [travelDate - 45 days, travelDate - 15 days].
 * For range mode the window is unioned across the full travel date span:
 *   [travelDateFrom - 45,  travelDateTo - 15]
 *
 * If the customer has no travel date set (mode=auto or missing), we allow the job (return true).
 * If openDates is empty we also allow (scout found something, dates may not be populated).
 */
function customerHasMatchingSlot(prefs: Record<string, unknown>, openDates: string[], windowDays?: { minBeforeTravel?: number; maxBeforeTravel?: number }): boolean {
  if (openDates.length === 0) return true; // no date info → allow

  const mode = String(prefs.travelDateMode ?? 'auto').trim();

  if (mode === 'auto' || mode === '') return true; // no constraint

  if (mode === 'single') {
    const td = parseTravelDate(String(prefs.travelDateSingle ?? ''));
    if (!td) return true; // unparseable → allow
    const { start, end } = appointmentWindow(td, windowDays);
    return openDates.some((raw) => {
      const d = parseOpenDate(raw);
      if (!d) return false;
      return d >= start && d <= end;
    });
  }

  if (mode === 'range') {
    const tdFrom = parseTravelDate(String(prefs.travelDateFrom ?? ''));
    const tdTo   = parseTravelDate(String(prefs.travelDateTo   ?? ''));
    const maxBefore = Math.max(1, windowDays?.maxBeforeTravel ?? 45);
    const minBefore = Math.max(0, windowDays?.minBeforeTravel ?? 15);
    const rangeStart = tdFrom ? new Date(tdFrom.getTime() - maxBefore * 86_400_000) : null;
    const rangeEnd   = tdTo   ? new Date(tdTo.getTime()   - minBefore * 86_400_000) : null;
    if (!rangeStart && !rangeEnd) return true; // no dates → allow
    return openDates.some((raw) => {
      const d = parseOpenDate(raw);
      if (!d) return false;
      if (rangeStart && d < rangeStart) return false;
      if (rangeEnd   && d > rangeEnd)   return false;
      return true;
    });
  }

  return true; // unknown mode → allow
}

/**
 * From the full open-dates list, return only those that fall within this customer's window.
 * Used to set applicant_data.open_dates so the booking agent can pick the right date.
 */
function filterDatesForCustomer(prefs: Record<string, unknown>, openDates: string[], windowDays?: { minBeforeTravel?: number; maxBeforeTravel?: number }): string[] {
  if (openDates.length === 0) return [];
  const mode = String(prefs.travelDateMode ?? 'auto').trim();
  if (mode === 'auto' || mode === '') return openDates;

  if (mode === 'single') {
    const td = parseTravelDate(String(prefs.travelDateSingle ?? ''));
    if (!td) return openDates;
    const { start, end } = appointmentWindow(td, windowDays);
    return openDates.filter((raw) => {
      const d = parseOpenDate(raw);
      return d !== null && d >= start && d <= end;
    });
  }

  if (mode === 'range') {
    const tdFrom = parseTravelDate(String(prefs.travelDateFrom ?? ''));
    const tdTo   = parseTravelDate(String(prefs.travelDateTo   ?? ''));
    const maxBefore = Math.max(1, windowDays?.maxBeforeTravel ?? 45);
    const minBefore = Math.max(0, windowDays?.minBeforeTravel ?? 15);
    const rangeStart = tdFrom ? new Date(tdFrom.getTime() - maxBefore * 86_400_000) : null;
    const rangeEnd   = tdTo   ? new Date(tdTo.getTime()   - minBefore * 86_400_000) : null;
    if (!rangeStart && !rangeEnd) return openDates;
    return openDates.filter((raw) => {
      const d = parseOpenDate(raw);
      if (!d) return false;
      if (rangeStart && d < rangeStart) return false;
      if (rangeEnd   && d > rangeEnd)   return false;
      return true;
    });
  }

  return openDates;
}

// ---------------------------------------------------------------------------

interface SnapshotParams {
  id: string;
}

function buildWatcherNoJobsMessage(
  upPortalIds: string[],
  downPortalIds: string[],
  upPortalsWithNoCustomers: string[]
): string {
  if (upPortalIds.length === 0) {
    return 'Run completed. All selected portals were down (check Settings → Mock: enable "Use mock portals" and set Default base URL, e.g. http://mock-portal:3004).';
  }
  if (upPortalsWithNoCustomers.length === upPortalIds.length) {
    return 'Run completed. Portals are up but there are no active bookings for these portals. Add at least one active booking per portal in Bookings to get slot-check runs.';
  }
  const parts: string[] = [];
  if (downPortalIds.length > 0) {
    parts.push(`${downPortalIds.length} portal(s) down (${downPortalIds.join(', ')})`);
  }
  if (upPortalsWithNoCustomers.length > 0) {
    parts.push(`no active bookings for: ${upPortalsWithNoCustomers.join(', ')}`);
  }
  return `Run completed. No slot-check jobs created: ${parts.join('; ')}.`;
}

export const watcherRoutes: FastifyPluginAsync = async (app) => {
  const db = getDb();
  const watcherRepo = new WatcherRepository(db);
  const portalRepo = new PortalConfigRepository(db);

  /**
   * Get watcher configuration.
   * If enabled but tenant has no Scout agent, force disabled and persist (watcher must not stay enabled without scout).
   */
  app.get('/', async (request) => {
    let config = await watcherRepo.findConfigByTenantId(request.tenantId);

    if (!config) {
      config = await watcherRepo.createConfig({
        tenant_id: request.tenantId,
      });
    }

    let effectiveEnabled = config.enabled;
    let disabledReason: string | null = null;

    if (config.enabled) {
      const profileRepo = new ProfileRepository(db);
      const agentRepo = new AgentRepository(db);
      const scoutProfileIds = await profileRepo.findScoutProfileIds(request.tenantId);
      const scoutAgents = await agentRepo.findByTenantId(request.tenantId, {
        profile_ids: scoutProfileIds,
        status: 'ONLINE',
        limit: 1,
      });
      if (scoutProfileIds.length === 0 || scoutAgents.length === 0) {
        effectiveEnabled = false;
        disabledReason = 'no_scout_agent';
        await watcherRepo.upsertConfig(request.tenantId, { enabled: false });
        config = { ...config, enabled: false };
      }
    }

    return {
      success: true,
      data: {
        config: { ...config, enabled: effectiveEnabled },
        status: effectiveEnabled ? 'enabled' : 'disabled',
        disabled_reason: disabledReason,
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
  app.patch<{ Body: UpdateWatcherConfigRequest }>('/', async (request, reply) => {
    const body = request.body;
    const updates: Record<string, unknown> = {};

    if (body.enabled === true) {
      const profileRepo = new ProfileRepository(db);
      const agentRepo = new AgentRepository(db);
      const scoutProfileIds = await profileRepo.findScoutProfileIds(request.tenantId);
      if (scoutProfileIds.length === 0) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'SCOUT_REQUIRED',
            message: 'Enable at least one Scout agent before enabling Watcher. Create a profile with "Scout" checked and assign an agent to it (Agents → create agent with Scout profile).',
          },
        });
      }
      const scoutAgents = await agentRepo.findByTenantId(request.tenantId, {
        profile_ids: scoutProfileIds,
        status: 'ONLINE',
        limit: 1,
      });
      if (scoutAgents.length === 0) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'SCOUT_REQUIRED',
            message: 'No online Scout agent. Start or enable a Scout agent (Agents) so it shows as online, then enable Watcher.',
          },
        });
      }
    }

    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.time_window_enabled !== undefined) updates.time_window_enabled = body.time_window_enabled;
    if (body.window_start_hour !== undefined) updates.window_start_hour = body.window_start_hour;
    if (body.window_end_hour !== undefined) updates.window_end_hour = body.window_end_hour;
    if (body.jitter_minutes !== undefined) updates.jitter_minutes = body.jitter_minutes;
    if (body.portals !== undefined) updates.portals = body.portals;
    if (body.notify_on_change !== undefined) updates.notify_on_change = body.notify_on_change;
    if (body.diff_mode !== undefined) updates.diff_mode = body.diff_mode;
    if (body.run_retention_days !== undefined) updates.run_retention_days = body.run_retention_days;
    if (body.snapshot_retention_days !== undefined) updates.snapshot_retention_days = body.snapshot_retention_days;
    if (body.html_diff_interval !== undefined) updates.html_diff_interval = body.html_diff_interval;

    const config = await watcherRepo.upsertConfig(request.tenantId, updates);

    return {
      success: true,
      data: config,
    };
  });

  /**
   * Get slot-check interval (global system_settings): fixed_ms + jitter_ms (±)
   * GET /cp/watcher/interval
   */
  app.get('/interval', async () => {
    const settingsRepo = new SystemSettingsRepository(getDb());
    const fixed_ms = await settingsRepo.getNumber(null, 'system', 'watcher_interval_fixed_ms', 5 * 60 * 1000);
    const jitter_ms = await settingsRepo.getNumber(null, 'system', 'watcher_interval_jitter_ms', 60 * 1000);
    return {
      success: true,
      data: { fixed_ms, jitter_ms },
    };
  });

  /**
   * Update slot-check interval (global system_settings)
   * PATCH /cp/watcher/interval
   */
  app.patch<{ Body: { fixed_ms?: number; jitter_ms?: number } }>('/interval', async (request) => {
    const body = request.body ?? {};
    const settingsRepo = new SystemSettingsRepository(getDb());
    if (body.fixed_ms !== undefined) await settingsRepo.setValue(null, 'system', 'watcher_interval_fixed_ms', body.fixed_ms, { valueType: 'number' });
    if (body.jitter_ms !== undefined) await settingsRepo.setValue(null, 'system', 'watcher_interval_jitter_ms', body.jitter_ms, { valueType: 'number' });
    const fixed_ms = await settingsRepo.getNumber(null, 'system', 'watcher_interval_fixed_ms', 5 * 60 * 1000);
    const jitter_ms = await settingsRepo.getNumber(null, 'system', 'watcher_interval_jitter_ms', 60 * 1000);
    return {
      success: true,
      data: { fixed_ms, jitter_ms },
    };
  });

  /**
   * Slot open: called by DP when a slot-check (scout) job finds a slot.
   * Creates and enqueues one job per active customer for that portal. Requires X-Internal-Secret.
   * POST /cp/watcher/slot-open
   */
  app.post<{ Body: { tenant_id: string; portal_id: string; open_dates?: string[]; scout_job_id?: string; triggered_by?: 'manual' | 'watcher_auto' } }>('/slot-open', async (request, reply) => {
    const secret = request.headers['x-internal-secret'] as string | undefined;
    const expected = process.env.CP_INTERNAL_SECRET;
    if (!expected || secret !== expected) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or missing X-Internal-Secret' },
      });
    }
    const { tenant_id, portal_id, open_dates = [], scout_job_id, triggered_by = 'watcher_auto' } = request.body ?? {};
    if (!tenant_id || !portal_id) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'tenant_id and portal_id required' },
      });
    }
    const customerRepo = new CustomerRepository(getDb());
    const agentRepo = new AgentRepository(getDb());
    const jobService = new JobService();
    const { items: customers } = await customerRepo.findWithFilters({
      tenantId: tenant_id,
      status: 'active',
      portalId: portal_id,
      limit: 500,
    });

    // Load portal config for appointment window settings (optional — falls back to defaults)
    const portalCfg = await portalRepo.findById(tenant_id, portal_id).catch(() => undefined);
    const windowDays = (portalCfg?.config as Record<string, unknown> | undefined)?.appointmentWindowDays as
      | { minBeforeTravel?: number; maxBeforeTravel?: number }
      | undefined;

    // Routing decision: manual triggers → SYNC agent; automatic watcher → ASYNC queue
    const routeToSync = triggered_by === 'manual';

    // For manual triggers, find an idle SYNC agent (with stale-reference cleanup)
    type SyncAgentRow = Awaited<ReturnType<typeof agentRepo.findByTenantId>>[0];
    let syncAgent: SyncAgentRow | null = null;
    if (routeToSync) {
      const allSyncAgents = await agentRepo.findByTenantId(tenant_id, { status: 'ONLINE', mode: 'SYNC' });
      syncAgent = allSyncAgents.find((a) => !a.current_job_id) ?? null;
      if (!syncAgent) {
        for (const agent of allSyncAgents) {
          if (!agent.current_job_id) continue;
          const stalJob = await getDb()
            .selectFrom('jobs')
            .select('status')
            .where('id', '=', agent.current_job_id)
            .executeTakeFirst();
          if (!stalJob || stalJob.status !== 'RUNNING') {
            await agentRepo.update(tenant_id, agent.id, { current_job_id: null });
            agent.current_job_id = null;
            syncAgent = agent;
            break;
          }
        }
      }
      if (!syncAgent && allSyncAgents.length > 0) syncAgent = allSyncAgents[0];
    }

    let jobsCreated = 0;
    let skipped = 0;
    for (const customer of customers) {
      try {
        const prefs = (customer.preferences ?? {}) as Record<string, unknown>;

        if (!customerHasMatchingSlot(prefs, open_dates, windowDays)) {
          skipped++;
          request.log.debug(
            { customerId: customer.id, openDatesCount: open_dates.length },
            'Slot-open: no open date matches customer travel window, skipping',
          );
          continue;
        }

        const filteredDates = filterDatesForCustomer(prefs, open_dates, windowDays);
        const applicant: ApplicantData = {
          ...prefs,
          name: (typeof prefs.name === 'string' ? prefs.name : null) || customer.display_name,
          open_dates: filteredDates.length > 0 ? filteredDates : open_dates,
        };
        const jobConfig = { slot_check_only: false, triggered_by };

        if (routeToSync && syncAgent) {
          // Manual trigger → SYNC agent dedicated queue
          const result = await jobService.createJob({
            tenant_id,
            portal_id: customer.portal_id,
            visa_type: 'SCHENGEN',
            priority: customer.priority,
            applicant,
            config: jobConfig,
          }, { skipQueue: true });
          await enqueueSyncJob(syncAgent.id, {
            job_id: result.job_id,
            tenant_id,
            visa_type: 'SCHENGEN',
            priority: customer.priority,
            applicant_data: applicant,
            config: jobConfig,
            portal_id: customer.portal_id,
            attempt_number: 1,
          });
          request.log.debug(
            { customerId: customer.id, jobId: result.job_id, agentId: syncAgent.id, triggered_by },
            'Slot-open: job enqueued to SYNC agent (manual)',
          );
        } else {
          // Automatic watcher → ASYNC queue (background processing)
          await jobService.createJob({
            tenant_id,
            portal_id: customer.portal_id,
            visa_type: 'SCHENGEN',
            priority: customer.priority,
            applicant,
            config: jobConfig,
          });
          request.log.debug(
            { customerId: customer.id, triggered_by },
            'Slot-open: job sent to ASYNC queue (watcher_auto)',
          );
        }
        jobsCreated++;
      } catch (err) {
        request.log.warn({ err, customerId: customer.id, portal_id }, 'Slot-open: failed to create job for customer');
      }
    }

    request.log.info({ tenant_id, portal_id, jobsCreated, skipped, openDatesCount: open_dates.length, triggered_by }, 'Slot-open: customer jobs created');

    // Persist open_dates on the scout job itself so /slots endpoint can read them back
    if (scout_job_id && open_dates.length > 0) {
      try {
        const jobRepo = new JobRepository(db);
        const scoutJob = await jobRepo.findById(scout_job_id);
        if (scoutJob) {
          const existingData = (scoutJob.applicant_data as Record<string, unknown> | null) ?? {};
          await jobRepo.update(scout_job_id, {
            applicant_data: { ...existingData, open_dates },
          });
          request.log.debug({ scout_job_id, dateCount: open_dates.length }, 'Slot-open: persisted open_dates on scout job');
        }
      } catch (err) {
        request.log.warn({ err, scout_job_id }, 'Slot-open: failed to persist open_dates on scout job (non-fatal)');
      }
    }

    return reply.send({
      success: true,
      data: { jobs_created: jobsCreated, skipped },
    });
  });

  /**
   * Get current open slots per portal (from latest completed scout jobs).
   * GET /cp/watcher/slots
   *
   * Returns portal → open_dates list (from last scout job applicant_data.open_dates or job events).
   * Also returns per-portal customer counts broken down by whether their travel window matches.
   */
  app.get('/slots', async (request) => {
    const jobRepo = new JobRepository(db);
    const customerRepo = new CustomerRepository(getDb());

    // Find all enabled portals for this tenant
    const enabledPortals = await portalRepo.findByTenantId(request.tenantId, { enabled: true });

    const result: Array<{
      portal_id: string;
      portal_name: string;
      open_dates: string[];
      last_checked_at: string | null;
      matching_customers: number;
      total_active_customers: number;
    }> = [];

    for (const portal of enabledPortals) {
      // Find the latest completed scout job for this portal
      const recentJobs = await jobRepo.findWithFilters({
        tenantId: request.tenantId,
        status: 'COMPLETED',
        limit: 50,
      });

      // Filter to scout jobs for this portal that have open_dates
      const scoutJob = recentJobs.items.find((j) => {
        const cfg = (j.config as Record<string, unknown> | null) ?? {};
        const app = (j.applicant_data as Record<string, unknown> | null) ?? {};
        const portalId = (cfg.portal_id as string | undefined) ?? (app.portal_id as string | undefined) ?? portal.portal_id;
        return (
          cfg.slot_check_only === true &&
          portalId === portal.portal_id &&
          Array.isArray(app.open_dates) &&
          (app.open_dates as string[]).length > 0
        );
      });

      const openDates: string[] = scoutJob
        ? (((scoutJob.applicant_data as Record<string, unknown>)?.open_dates as string[]) ?? [])
        : [];

      // Count active customers and how many have matching windows
      const { items: customers } = await customerRepo.findWithFilters({
        tenantId: request.tenantId,
        status: 'active',
        portalId: portal.portal_id,
        limit: 500,
      });

      let matchingCount = 0;
      for (const c of customers) {
        const prefs = (c.preferences ?? {}) as Record<string, unknown>;
        if (customerHasMatchingSlot(prefs, openDates)) matchingCount++;
      }

      result.push({
        portal_id: portal.portal_id,
        portal_name: portal.name,
        open_dates: openDates,
        last_checked_at: scoutJob?.updated_at ? new Date(scoutJob.updated_at).toISOString() : null,
        matching_customers: matchingCount,
        total_active_customers: customers.length,
      });
    }

    return { success: true, data: result };
  });

  /**
   * Grab a slot immediately for a customer using a SYNC agent.
   * POST /cp/watcher/grab-booking
   *
   * Creates a booking job with the provided open_dates pre-filled so the agent
   * skips SLOT_SEARCHING and goes straight to booking. Assigns the job to an
   * idle SYNC agent so it runs immediately (not queued for async workers).
   *
   * Body: { customer_id, portal_id, open_dates }
   * Returns: { job_id, agent_id, agent_name }
   */
  app.post<{ Body: { customer_id: string; portal_id: string; open_dates: string[]; preferred_date?: string } }>('/grab-booking', async (request, reply) => {
    const { customer_id, portal_id, open_dates, preferred_date } = request.body ?? {};

    if (!customer_id || !portal_id || !Array.isArray(open_dates) || open_dates.length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'customer_id, portal_id, and open_dates (non-empty) are required' },
      });
    }

    const customerRepo = new CustomerRepository(getDb());
    const agentRepo = new AgentRepository(getDb());
    const jobService = new JobService();

    // Validate customer
    const customer = await customerRepo.findById(request.tenantId, customer_id);
    if (!customer) {
      return reply.status(404).send({
        success: false,
        error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' },
      });
    }
    if (customer.status !== 'active') {
      return reply.status(400).send({
        success: false,
        error: { code: 'CUSTOMER_NOT_ACTIVE', message: 'Customer is not active' },
      });
    }

    // Find an idle SYNC agent for this portal
    const allAgents = await agentRepo.findByTenantId(request.tenantId, { status: 'ONLINE', mode: 'SYNC' });

    // An agent is truly idle if it has no current_job_id, OR its current_job_id points to a
    // job that is no longer RUNNING (stale reference from a crashed/restarted DP container).
    let idleAgent = allAgents.find((a) => !a.current_job_id);
    if (!idleAgent) {
      const db = getDb();
      for (const agent of allAgents) {
        if (!agent.current_job_id) continue;
        const job = await db
          .selectFrom('jobs')
          .select('status')
          .where('id', '=', agent.current_job_id)
          .executeTakeFirst();
        if (!job || job.status !== 'RUNNING') {
          await agentRepo.update(request.tenantId, agent.id, { current_job_id: null });
          agent.current_job_id = null;
          idleAgent = agent;
          request.log.warn(
            { agentId: agent.id, staleJobId: agent.current_job_id, jobStatus: job?.status },
            'Cleared stale current_job_id from SYNC agent',
          );
          break;
        }
      }
    }

    if (!idleAgent) {
      return reply.status(503).send({
        success: false,
        error: { code: 'NO_SYNC_AGENT', message: 'No idle SYNC agent available. Try again in a moment.' },
      });
    }

    // Build applicant data with open_dates so SLOT_SEARCHING is skipped
    const prefs = (customer.preferences ?? {}) as Record<string, unknown>;
    const filteredDates = filterDatesForCustomer(prefs, open_dates);
    const applicant: ApplicantData = {
      ...prefs,
      name: (typeof prefs.name === 'string' ? prefs.name : null) || customer.display_name,
      open_dates: filteredDates.length > 0 ? filteredDates : open_dates,
      // If a specific date was selected in the UI (e.g. Grab button on a date card),
      // inject it directly as appointmentDate so form-values skips the algorithm entirely.
      // Convert from YYYY-M-D (TarihGetir format) to DD/MM/YYYY (AS-VISA form format).
      ...(preferred_date ? (() => {
        const d = parseTravelDate(preferred_date);
        if (!d) return {};
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = String(d.getUTCFullYear());
        return { appointmentDate: `${dd}/${mm}/${yyyy}` };
      })() : {}),
    };

    // Create the booking job (no queue — pushed directly to agent's dedicated sync queue below)
    let jobResult: { job_id: string };
    try {
      jobResult = await jobService.createJob({
        tenant_id: request.tenantId,
        portal_id: customer.portal_id,
        visa_type: 'SCHENGEN',
        priority: customer.priority,
        applicant,
        config: { slot_check_only: false, triggered_by: 'manual' },
      }, { skipQueue: true });
    } catch (err) {
      request.log.error({ err, customer_id }, 'grab-booking: failed to create job');
      return reply.status(500).send({
        success: false,
        error: { code: 'JOB_CREATE_FAILED', message: err instanceof Error ? err.message : 'Failed to create job' },
      });
    }

    // Push directly to the SYNC agent's dedicated queue (visa-sync__<agentId>)
    // The SyncAgentRunner on DP subscribes to this queue — no polling, no current_job_id.
    await enqueueSyncJob(idleAgent.id, {
      job_id: jobResult.job_id,
      tenant_id: request.tenantId,
      visa_type: 'SCHENGEN',
      priority: customer.priority,
      applicant_data: applicant,
      config: { slot_check_only: false, triggered_by: 'manual' },
      portal_id: customer.portal_id,
      attempt_number: 1,
    });

    request.log.info(
      { customerId: customer_id, jobId: jobResult.job_id, agentId: idleAgent.id, dateCount: open_dates.length },
      'grab-booking: job created and enqueued to SYNC agent queue',
    );

    return {
      success: true,
      data: {
        job_id: jobResult.job_id,
        agent_id: idleAgent.id,
        agent_name: idleAgent.name,
        open_dates_count: (applicant.open_dates as string[] | undefined)?.length ?? 0,
        message: `Job assigned to sync agent "${idleAgent.name}". Check the Jobs page for progress.`,
      },
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

    const profileRepo = new ProfileRepository(db);
    const agentRepo = new AgentRepository(db);
    const scoutProfileIds = await profileRepo.findScoutProfileIds(request.tenantId);
    if (scoutProfileIds.length === 0) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'SCOUT_REQUIRED',
          message: 'No Scout profile. Create a profile with Scout checked and assign an agent (Agents → Scout profile).',
        },
      });
    }
    const scoutAgents = await agentRepo.findByTenantId(request.tenantId, {
      profile_ids: scoutProfileIds,
      status: 'ONLINE',
      limit: 1,
    });
    if (scoutAgents.length === 0) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'SCOUT_REQUIRED',
          message: 'No online Scout agent. Start a Scout agent (Agents) so it shows as online.',
        },
      });
    }

    const result = await runWatcherForTenant(
      request.log,
      request.tenantId,
      portalsToCheck,
      'manual',
    );
    const { jobsCreated, createdJobIds, upPortalIds, downPortalIds, upPortalsWithNoCustomers } = result;
    request.log.info(
      { tenantId: request.tenantId, portals: portalsToCheck.length, jobsCreated, createdJobIds, upPortalIds, downPortalIds, upPortalsWithNoCustomers },
      'Watcher run-now completed'
    );

    const message = jobsCreated > 0
      ? `Created ${jobsCreated} slot-check (scout) job(s).${createdJobIds.length > 0 ? ` Job(s): ${createdJobIds.join(', ')}.` : ''}`
      : buildWatcherNoJobsMessage(upPortalIds, downPortalIds, upPortalsWithNoCustomers);

    if (typeof watcherRepo.createRunHistory === 'function') {
      await watcherRepo.createRunHistory(request.tenantId, {
        portals_checked: portalsToCheck,
        jobs_created: jobsCreated,
        up_portal_ids: upPortalIds,
        down_portal_ids: downPortalIds,
        up_portals_with_no_customers: upPortalsWithNoCustomers,
        message,
      });
    } else {
      request.log.warn('WatcherRepository.createRunHistory not available (rebuild @visa-automation/db)');
    }

    // Telegram: Watcher channel only gets SLOT OPEN and HTML Drift (no slot-check jobs created)

    const runRetentionDays = Math.max(1, Math.min(365, config.run_retention_days ?? 7));
    const snapshotRetentionDays = Math.max(1, Math.min(365, config.snapshot_retention_days ?? 7));
    const runOlderThan = new Date(Date.now() - runRetentionDays * 24 * 60 * 60 * 1000);
    const snapshotOlderThan = new Date(Date.now() - snapshotRetentionDays * 24 * 60 * 60 * 1000);
    const deleted = await watcherRepo.deleteOldSnapshots(request.tenantId, snapshotOlderThan);
    if (deleted > 0) request.log.info({ tenantId: request.tenantId, deleted }, 'Run-now: pruned old snapshots');
    const deletedRuns = await watcherRepo.deleteOldRunHistory(request.tenantId, runOlderThan);
    if (deletedRuns > 0) request.log.info({ tenantId: request.tenantId, deletedRuns }, 'Run-now: pruned old run history');

    return {
      success: true,
      data: {
        triggered: true,
        portals: portalsToCheck,
        jobs_created: jobsCreated,
        created_job_ids: createdJobIds,
        up_portal_ids: upPortalIds,
        down_portal_ids: downPortalIds,
        up_portals_with_no_customers: upPortalsWithNoCustomers,
        message,
      },
    };
  });

  /**
   * Get watcher run history (7-day retention).
   * GET /cp/watcher/run-history?limit=50
   */
  app.get<{ Querystring: { limit?: string } }>('/run-history', async (request) => {
    const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 200);
    const runs = await watcherRepo.findRunHistory(request.tenantId, limit);
    return {
      success: true,
      data: {
        items: runs.map(r => ({
          id: r.id,
          run_at: r.run_at,
          portals_checked: r.portals_checked ?? [],
          jobs_created: r.jobs_created,
          up_portal_ids: r.up_portal_ids ?? [],
          down_portal_ids: r.down_portal_ids ?? [],
          up_portals_with_no_customers: r.up_portals_with_no_customers ?? [],
          message: r.message,
        })),
        total: runs.length,
      },
    };
  });

  /**
   * Clear all run history for tenant (manual).
   * DELETE /cp/watcher/run-history
   */
  app.delete('/run-history', async (request) => {
    const deleted = await watcherRepo.deleteAllRunHistory(request.tenantId);
    request.log.info({ tenantId: request.tenantId, deleted }, 'Watcher run history cleared');
    return { success: true, data: { deleted } };
  });

  /**
   * List snapshots (default: non-archived; ?archived=true for archived only)
   * GET /cp/watcher/snapshots
   */
  app.get<{
    Querystring: {
      portal_id?: string;
      from?: string;
      to?: string;
      severity?: string;
      archived?: string;
      limit?: string;
      offset?: string;
    };
  }>('/snapshots', async (request) => {
    const options: {
      portalId?: string;
      from?: Date;
      to?: Date;
      severity?: DiffSeverity[];
      archived?: boolean;
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
    if (request.query.archived === 'true') options.archived = true;
    else options.archived = false; // default: only non-archived (archived have their own section)

    const snapshots = await watcherRepo.findSnapshots(request.tenantId, options);
    const total =
      typeof watcherRepo.countSnapshotsWithFilters === 'function'
        ? await watcherRepo.countSnapshotsWithFilters(request.tenantId, {
            portalId: options.portalId,
            from: options.from,
            to: options.to,
            severity: options.severity,
            archived: options.archived,
          })
        : await watcherRepo.countSnapshots(request.tenantId, options.portalId);

    const snapshotSummaries = snapshots.map(s => ({
      id: s.id,
      portal_id: s.portal_id,
      captured_at: s.captured_at,
      html_hash: s.html_hash,
      diff_severity: s.diff_severity,
      diff_summary: s.diff_summary,
      has_screenshot: !!s.screenshot_path,
      metadata: s.metadata,
      archived: s.archived,
      archived_at: s.archived_at,
    }));

    return {
      success: true,
      data: {
        items: snapshotSummaries,
        total,
      },
    };
  });

  /**
   * Clear all snapshots for tenant (manual).
   * DELETE /cp/watcher/snapshots
   */
  app.delete('/snapshots', async (request) => {
    const deleted = await watcherRepo.deleteAllSnapshots(request.tenantId);
    request.log.info({ tenantId: request.tenantId, deleted }, 'Watcher snapshots cleared');
    return { success: true, data: { deleted } };
  });

  /**
   * Archive or unarchive a snapshot (archived snapshots are kept beyond 7-day retention).
   * Optional archive_summary (note) when archiving.
   * PATCH /cp/watcher/snapshots/:id
   */
  app.patch<{ Params: SnapshotParams; Body: { archived?: boolean; archive_summary?: string } }>('/snapshots/:id', async (request, reply) => {
    const snapshot = await watcherRepo.findSnapshotById(request.params.id);
    if (!snapshot || snapshot.tenant_id !== request.tenantId) {
      return reply.status(404).send({
        success: false,
        error: { code: 'SNAPSHOT_NOT_FOUND', message: 'Snapshot not found' },
      });
    }
    const archived = request.body?.archived;
    if (archived === undefined) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_REQUIRED', message: 'body.archived is required (true or false)' },
      });
    }
    const archiveSummary = archived ? (request.body?.archive_summary?.trim() || null) : null;
    const db = getDb();
    const [updated] = await db
      .updateTable('portal_snapshots')
      .set({
        archived,
        archived_at: archived ? new Date() : null,
        archive_summary: archiveSummary,
      })
      .where('id', '=', request.params.id)
      .where('tenant_id', '=', request.tenantId)
      .returningAll()
      .execute();
    return { success: true, data: updated };
  });

  /**
   * Get latest archived snapshot for a portal (full snapshot with html, for diff base).
   * GET /cp/watcher/snapshots/latest-archived?portal_id=X&exclude_snapshot_id=Y
   * When exclude_snapshot_id is set, returns the latest archived that is not that id (so diff view has a different base).
   */
  app.get<{ Querystring: { portal_id: string; exclude_snapshot_id?: string } }>('/snapshots/latest-archived', async (request, reply) => {
    const portal_id = request.query.portal_id;
    if (!portal_id) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_REQUIRED', message: 'portal_id is required' },
      });
    }
    const exclude_snapshot_id = request.query.exclude_snapshot_id?.trim() || undefined;
    const snapshot = await watcherRepo.findLatestArchivedSnapshot(request.tenantId, portal_id, exclude_snapshot_id);
    if (!snapshot) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: exclude_snapshot_id
            ? 'No other archived snapshot for this portal to use as diff base.'
            : 'No archived snapshot for this portal',
        },
      });
    }
    return { success: true, data: snapshot };
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
   * Get watcher status.
   * If enabled but no Scout agent, force disabled and persist; return effective config and disabled_reason.
   */
  app.get('/status', async (request) => {
    let config = await watcherRepo.findConfigByTenantId(request.tenantId);

    if (!config) {
      return {
        success: true,
        data: {
          status: 'not_configured',
          config: null,
          disabled_reason: null,
        },
      };
    }

    let effectiveEnabled = config.enabled;
    let disabledReason: string | null = null;

    if (config.enabled) {
      const profileRepo = new ProfileRepository(db);
      const agentRepo = new AgentRepository(db);
      const scoutProfileIds = await profileRepo.findScoutProfileIds(request.tenantId);
      const scoutAgents = await agentRepo.findByTenantId(request.tenantId, {
        profile_ids: scoutProfileIds,
        status: 'ONLINE',
        limit: 1,
      });
      if (scoutProfileIds.length === 0 || scoutAgents.length === 0) {
        effectiveEnabled = false;
        disabledReason = 'no_scout_agent';
        await watcherRepo.upsertConfig(request.tenantId, { enabled: false });
        config = { ...config, enabled: false };
      }
    }

    const recentSnapshots = await watcherRepo.findSnapshots(request.tenantId, { limit: 10, archived: false });

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
        config: { ...config, enabled: effectiveEnabled },
        status: effectiveEnabled ? 'enabled' : 'disabled',
        disabled_reason: disabledReason,
        last_results: lastResults,
      },
    };
  });
};
