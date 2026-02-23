import type { Logger } from 'pino';
import type { JobQueuePayload } from '@visa-automation/shared';
import { db, JobRepository, JobEventRepository } from '@visa-automation/db';
import { runFSM } from './core/fsm/runner.js';
import { createHitlTask } from './core/hitl/handler.js';
import { JOB_STATES } from '@visa-automation/shared';
import type { AgentProfileConfig } from '@visa-automation/shared';
import type { PortalId, DeepPartial } from './config/types.js';
import type { PortalConfig } from './config/types.js';
import { resolvePortalConfig } from './config/loader.js';
import { getPortal, getFSMHandlers } from './portals/registry.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`${name} is required (no default in production). Set it in environment.`);
  }
  return v;
}

const CP_API_URL = requireEnv('CP_API_URL');

/** Thrown when job transitions to WAITING_HITL; runner must not release the agent (no completeJob/failJob). */
export class HitlWaitingError extends Error {
  constructor(public readonly jobId: string) {
    super(`Job ${jobId} waiting for HITL`);
    this.name = 'HitlWaitingError';
  }
}

/**
 * Fetch full portal config from CP (Admin Portals). When the portal exists in DB with base_url
 * and config (timeouts, pacing, rateLimit, proxy, hitl, selectorsVersion), that becomes the
 * primary source and the local file is not used. Each job run gets current values from Postgres.
 */
async function fetchPortalConfigFromCP(
  portalId: string,
  tenantId: string
): Promise<DeepPartial<PortalConfig> | null> {
  try {
    const url = `${CP_API_URL.replace(/\/$/, '')}/cp/portals/by-portal-id/${encodeURIComponent(portalId)}`;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
    });
    if (res.status === 404 || !res.ok) return null;
    const json = (await res.json()) as {
      success?: boolean;
      data?: {
        base_url?: string | null;
        config?: Record<string, unknown>;
        selectors?: Record<string, unknown>;
      };
    };
    const data = json?.data;
    if (!data?.base_url) return null;
    const primary: DeepPartial<PortalConfig> = { baseUrl: data.base_url };
    if (data.config && typeof data.config === 'object') {
      if (data.config.timeouts && typeof data.config.timeouts === 'object')
        primary.timeouts = data.config.timeouts as PortalConfig['timeouts'];
      if (data.config.pacing && typeof data.config.pacing === 'object')
        primary.pacing = data.config.pacing as PortalConfig['pacing'];
      if (data.config.rateLimit && typeof data.config.rateLimit === 'object')
        primary.rateLimit = data.config.rateLimit as PortalConfig['rateLimit'];
      if (data.config.proxy && typeof data.config.proxy === 'object')
        primary.proxy = data.config.proxy as PortalConfig['proxy'];
      if (data.config.hitl && typeof data.config.hitl === 'object')
        primary.hitl = data.config.hitl as PortalConfig['hitl'];
      if (typeof data.config.selectorsVersion === 'string')
        primary.selectorsVersion = data.config.selectorsVersion;
      if (typeof data.config.minRunDurationMs === 'number' && data.config.minRunDurationMs >= 0)
        primary.minRunDurationMs = data.config.minRunDurationMs;
      if (typeof data.config.mouseMoveIntervalMs === 'number' && data.config.mouseMoveIntervalMs > 0)
        primary.mouseMoveIntervalMs = data.config.mouseMoveIntervalMs;
      if (typeof data.config.mouseMoveSegmentsMin === 'number' && data.config.mouseMoveSegmentsMin >= 0)
        primary.mouseMoveSegmentsMin = data.config.mouseMoveSegmentsMin;
      if (typeof data.config.mouseMoveSegmentsMax === 'number' && data.config.mouseMoveSegmentsMax > 0)
        primary.mouseMoveSegmentsMax = data.config.mouseMoveSegmentsMax;
      if (typeof data.config.mouseMoveJitterPx === 'number' && data.config.mouseMoveJitterPx >= 0)
        primary.mouseMoveJitterPx = data.config.mouseMoveJitterPx;
      if (typeof data.config.mouseMoveStepsMin === 'number' && data.config.mouseMoveStepsMin > 0)
        primary.mouseMoveStepsMin = data.config.mouseMoveStepsMin;
      if (typeof data.config.mouseMoveStepsMax === 'number' && data.config.mouseMoveStepsMax > 0)
        primary.mouseMoveStepsMax = data.config.mouseMoveStepsMax;
      if (typeof data.config.mouseMoveDelayMinMs === 'number' && data.config.mouseMoveDelayMinMs >= 0)
        primary.mouseMoveDelayMinMs = data.config.mouseMoveDelayMinMs;
      if (typeof data.config.mouseMoveDelayMaxMs === 'number' && data.config.mouseMoveDelayMaxMs >= 0)
        primary.mouseMoveDelayMaxMs = data.config.mouseMoveDelayMaxMs;
    }
    return primary;
  } catch {
    return null;
  }
}
import { scheduleSlotRetry } from './core/queue/schedule-retry.js';
import {
  notifyAgentStarted,
  notifyAgentCompleted,
  notifyAgentFailed,
  notifyBookingConfirmed,
  notifyHitlRequired,
} from './core/notify/index.js';
import { notifyJobCompletedEmail } from './core/notify/email.js';
import { classifyError } from './core/errors/classify.js';
import { metrics } from './core/observability/metrics.js';

/**
 * Main job processor - orchestrates the FSM execution
 */
export async function processJob(
  payload: JobQueuePayload,
  workerId: string,
  logger: Logger,
  profileConfig?: AgentProfileConfig | null,
  agentId?: string | null,
  agentName?: string | null
): Promise<void> {
  const jobRepo = new JobRepository(db.instance);
  const eventRepo = new JobEventRepository(db.instance);

  const { job_id, tenant_id } = payload;
  const portal_id = (payload.portal_id as string) ?? '';

  const claimStartMs = Date.now();
  const lockAcquired = await jobRepo.acquireLock(job_id, workerId, 5 * 60 * 1000); // 5 minute lock
  metrics.counter('dp_job_claims_total').inc(1);
  metrics.gauge('dp_job_claim_latency_ms').set(Date.now() - claimStartMs);

  if (!lockAcquired) {
    logger.warn({ jobId: job_id }, 'Failed to acquire lock, job may be processed by another worker');
    return;
  }

  let runStartMs = 0;
  let jobLogger: Logger = logger;
  let jobRun: { id: string } | undefined;

  try {
    // Create job run record (agent_id for job details UI)
    jobRun = await db.instance
      .insertInto('job_runs')
      .values({
        job_id,
        tenant_id,
        worker_id: workerId,
        agent_id: agentId ?? null,
        attempt_number: payload.attempt_number,
        status: 'RUNNING',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    jobLogger = logger.child({
      job_id,
      run_id: jobRun.id,
      tenant_id,
      portal_id,
    });

    jobLogger.info({ runId: jobRun.id }, 'Created job run');

    runStartMs = Date.now();

    // Portal config from CP only (no file). Missing or incomplete → fail.
    const portalId = (payload.portal_id ?? 'as-visa') as PortalId;
    const primaryFromCP = await fetchPortalConfigFromCP(portalId, tenant_id);
    if (!primaryFromCP?.baseUrl) {
      throw new Error(
        `Portal ${portalId} not configured in CP for tenant ${tenant_id}. Add the portal in Admin → Portals with base_url and config.`
      );
    }
    const jobOverride = (payload.config as Record<string, unknown> | undefined)?.portal as DeepPartial<PortalConfig> | undefined;
    const configPriority = profileConfig?.config_priority ?? 'portal_over_profile';
    const portalConfig = resolvePortalConfig({
      portalId,
      primaryFromCP,
      profileConfig: profileConfig ?? undefined,
      configPriority,
      jobOverride,
    });
    const portal = getPortal(portalConfig.portalId);

    try {
      await notifyAgentStarted({
        jobId: job_id,
        jobRunId: jobRun.id,
        tenantId: tenant_id,
        portalId: portalConfig.portalId,
        agentId: agentId ?? null,
        agentName: agentName ?? null,
        visaType: (payload as unknown as Record<string, unknown>).visa_type as string | undefined,
        priority: (payload as unknown as Record<string, unknown>).priority as number | undefined,
        logger: jobLogger,
      });
    } catch (e) {
      jobLogger.warn({ err: e }, 'Agent started notify failed');
    }

    // Run portal automation (temporary hook; FSM integration coming next)
    const portalResult = await portal.run({
      jobId: job_id,
      tenantId: tenant_id,
      portalConfig,
      jobData: payload,
    });

    // Run the FSM with this portal's registered handlers
    const handlers = getFSMHandlers(portalConfig.portalId);
    const result = await runFSM(
      payload,
      workerId,
      jobRun.id,
      jobLogger,
      portal,
      portalConfig,
      handlers,
      (profileConfig?.fingerprint as { enabled?: boolean } | undefined)
    );

    // Optional: enforce minimum run duration (human-like timing)
    const minRunMs = portalConfig.minRunDurationMs;
    if (minRunMs != null && minRunMs > 0) {
      const elapsed = Date.now() - runStartMs;
      if (elapsed < minRunMs) {
        const waitMs = minRunMs - elapsed;
        jobLogger.debug({ waitMs, minRunDurationMs: minRunMs }, 'Sleeping to meet min run duration');
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    // Confirmation number override (if portal produced one)
    if (portalResult.confirmationNumber) {
      result.confirmationNumber = portalResult.confirmationNumber;
    }

    if (result.lastState === JOB_STATES.CANCELLED) {
      await db.instance
        .updateTable('job_runs')
        .set({ status: 'COMPLETED', finished_at: new Date() })
        .where('id', '=', jobRun.id)
        .execute();
      metrics.gauge('dp_job_run_duration_ms').set(Date.now() - runStartMs);
      metrics.counter('dp_job_completions_total', { status: 'cancelled' }).inc(1);
      jobLogger.info({}, 'Job cancelled (STOP) - halted gracefully');
      try {
        await notifyAgentCompleted({
          jobId: job_id,
          jobRunId: jobRun.id,
          tenantId: tenant_id,
          portalId: portalConfig.portalId,
          agentId: agentId ?? null,
          agentName: agentName ?? null,
          status: 'cancelled',
          details: 'Stopped by user',
          logger: jobLogger,
        });
      } catch (e) {
        jobLogger.warn({ err: e }, 'Agent completed notify failed');
      }
      return;
    }

    // Slot found (we notified via Telegram) — stop here for MVP
    if (result.lastState === JOB_STATES.SLOT_FOUND) {
      await jobRepo.updateStatus(job_id, JOB_STATES.SLOT_FOUND);

      await eventRepo.createStateTransition(
        job_id,
        tenant_id,
        JOB_STATES.SLOT_SEARCHING,
        JOB_STATES.SLOT_FOUND,
        { reason: 'Slot found (notified)', channel: 'telegram' },
        jobRun.id
      );

      await db.instance
        .updateTable('job_runs')
        .set({ status: 'COMPLETED', finished_at: new Date() })
        .where('id', '=', jobRun.id)
        .execute();

      metrics.gauge('dp_job_run_duration_ms').set(Date.now() - runStartMs);
      metrics.counter('dp_job_completions_total', { status: 'slot_found' }).inc(1);
      jobLogger.info({}, 'Job halted at SLOT_FOUND');
      try {
        await notifyAgentCompleted({
          jobId: job_id,
          jobRunId: jobRun.id,
          tenantId: tenant_id,
          portalId: portalConfig.portalId,
          agentId: agentId ?? null,
          agentName: agentName ?? null,
          status: 'slot_found',
          logger: jobLogger,
        });
      } catch (e) {
        jobLogger.warn({ err: e }, 'Agent completed notify failed');
      }
      return;
    }

    // Check if job is waiting for a slot
    if (result.lastState === JOB_STATES.WAITING_SLOT) {
      const retryRaw = profileConfig?.retry as Record<string, unknown> | undefined;
      const profileRetry: { maxRetries?: number; retryDelayMs?: number } | undefined = retryRaw
        ? {
            maxRetries: typeof retryRaw.maxRetries === 'number' ? retryRaw.maxRetries : typeof retryRaw.maxAttempts === 'number' ? retryRaw.maxAttempts : undefined,
            retryDelayMs: typeof retryRaw.backoffMs === 'number' ? retryRaw.backoffMs : typeof retryRaw.delayMs === 'number' ? retryRaw.delayMs : undefined,
          }
        : undefined;
      const { delayMs, skipped } = await scheduleSlotRetry(payload, profileRetry);

      if (skipped) {
        await jobRepo.updateStatus(job_id, JOB_STATES.FAILED_RETRYABLE, {
          retry_count: payload.attempt_number,
        });
        await eventRepo.createStateTransition(
          job_id,
          tenant_id,
          JOB_STATES.PROCESSING,
          JOB_STATES.WAITING_SLOT,
          { reason: 'No slots found, max_retries exceeded', next_retry_ms: 0 },
          jobRun.id
        );
        await db.instance
          .updateTable('job_runs')
          .set({ status: 'FAILED', finished_at: new Date() })
          .where('id', '=', jobRun.id)
          .execute();
        metrics.counter('dp_job_errors_total', { kind: 'retryable' }).inc(1);
        metrics.counter('dp_job_retries_total').inc(1);
        jobLogger.warn({ attempt: payload.attempt_number }, 'Slot retry skipped: max_retries exceeded');
        try {
          await notifyAgentFailed({
            jobId: job_id,
            jobRunId: jobRun.id,
            tenantId: tenant_id,
            portalId: portalConfig.portalId,
            agentId: agentId ?? null,
            agentName: agentName ?? null,
            finalStatus: JOB_STATES.FAILED_RETRYABLE,
            reason: 'Max retries exceeded',
            logger: jobLogger,
          });
        } catch (e) {
          jobLogger.warn({ err: e }, 'Agent failed notify failed');
        }
        return;
      }

      await eventRepo.createStateTransition(
        job_id,
        tenant_id,
        JOB_STATES.PROCESSING,
        JOB_STATES.WAITING_SLOT,
        { reason: 'No slots found', next_retry_ms: delayMs },
        jobRun.id
      );

      await db.instance
        .updateTable('job_runs')
        .set({ status: 'COMPLETED', finished_at: new Date() })
        .where('id', '=', jobRun.id)
        .execute();

      metrics.counter('dp_job_retries_total').inc(1);
      jobLogger.info({ delayMs }, 'Job scheduled for slot retry');
      try {
        await notifyAgentCompleted({
          jobId: job_id,
          jobRunId: jobRun.id,
          tenantId: tenant_id,
          portalId: portalConfig.portalId,
          agentId: agentId ?? null,
          agentName: agentName ?? null,
          status: 'waiting_slot',
          details: `Scheduled retry in ${delayMs}ms`,
          logger: jobLogger,
        });
      } catch (e) {
        jobLogger.warn({ err: e }, 'Agent completed notify failed');
      }
      return;
    }

    // Slot-check-only job aborted (e.g. security code on page): no HITL, just retry later
    if (result.slotCheckAborted) {
      const reason =
        result.abortReason === 'security_code'
          ? 'Slot check could not complete (security code on page); will retry'
          : 'Slot check could not complete; will retry';
      await jobRepo.updateStatus(job_id, JOB_STATES.FAILED_RETRYABLE);
      await eventRepo.createStateTransition(
        job_id,
        tenant_id,
        result.lastState,
        JOB_STATES.FAILED_RETRYABLE,
        { reason },
        jobRun.id
      );
      await db.instance
        .updateTable('job_runs')
        .set({ status: 'FAILED', finished_at: new Date(), error_message: reason })
        .where('id', '=', jobRun.id)
        .execute();
      jobLogger.info({ abortReason: result.abortReason }, 'Slot-check aborted; marked FAILED_RETRYABLE');
      try {
        await notifyAgentFailed({
          jobId: job_id,
          jobRunId: jobRun.id,
          tenantId: tenant_id,
          portalId: portalConfig.portalId,
          agentId: agentId ?? null,
          agentName: agentName ?? null,
          finalStatus: JOB_STATES.FAILED_RETRYABLE,
          reason,
          logger: jobLogger,
        });
      } catch (e) {
        jobLogger.warn({ err: e }, 'Agent failed notify failed');
      }
      throw new Error(reason);
    }

    // Check if HITL was triggered (normal jobs only; slot-check jobs use slotCheckAborted above)
    if (result.hitlTriggered) {
      const hitlType = result.hitlType ?? 'CAPTCHA';
      const hitlExpiresSeconds =
        portalConfig.hitl.maxWaitSeconds > 0 ? portalConfig.hitl.maxWaitSeconds : undefined;
      const taskId = await createHitlTask({
        job_id,
        job_run_id: jobRun.id,
        tenant_id,
        type: hitlType,
        context: result.hitlContext ?? { prompt: 'Please solve the captcha', input_type: 'text' },
        timeoutSeconds: hitlExpiresSeconds,
      });

      const notifyExpiresSeconds = hitlExpiresSeconds ?? 180;
      await notifyHitlRequired({
        jobId: job_id,
        hitlType,
        taskId,
        expiresSeconds: notifyExpiresSeconds,
        tenantId: tenant_id,
        logger: jobLogger,
      });

      // Update job status to WAITING_HITL
      await jobRepo.updateStatus(job_id, JOB_STATES.WAITING_HITL);
      
      // Log the state transition
      await eventRepo.createStateTransition(
        job_id,
        tenant_id,
        result.lastState,
        JOB_STATES.WAITING_HITL,
        { reason: 'HITL triggered', hitl_type: result.hitlType },
        jobRun.id
      );

      // Update job run
      await db.instance
        .updateTable('job_runs')
        .set({ 
          status: 'COMPLETED',
          finished_at: new Date(),
          checkpoint_data: { waiting_hitl: true, resume_state: result.lastState },
        })
        .where('id', '=', jobRun.id)
        .execute();

      jobLogger.info({ hitlType: result.hitlType }, 'Job waiting for HITL');
      throw new HitlWaitingError(job_id);
    }

    // Job completed successfully
    await jobRepo.updateStatus(job_id, JOB_STATES.COMPLETED, {
      completed_at: new Date(),
    });

    await eventRepo.createStateTransition(
      job_id,
      tenant_id,
      result.lastState,
      JOB_STATES.COMPLETED,
      { confirmation_number: result.confirmationNumber },
      jobRun.id
    );

    // Update job run
    await db.instance
      .updateTable('job_runs')
      .set({ status: 'COMPLETED', finished_at: new Date() })
      .where('id', '=', jobRun.id)
      .execute();

    metrics.gauge('dp_job_run_duration_ms').set(Date.now() - runStartMs);
    metrics.counter('dp_job_completions_total', { status: 'completed' }).inc(1);
    jobLogger.info({ confirmationNumber: result.confirmationNumber }, 'Job completed');

    // Send completion email (skipped if SMTP not configured in CP notify settings)
    try {
      await notifyJobCompletedEmail({
        jobId: job_id,
        jobRunId: jobRun.id,
        tenantId: tenant_id,
        portalId: portalConfig.portalId,
        confirmationNumber: result.confirmationNumber,
        logger: jobLogger,
      });
    } catch (e) {
      jobLogger.warn({ err: e }, 'Job completion email failed');
    }

    try {
      if (result.confirmationNumber) {
        await notifyBookingConfirmed({
          jobId: job_id,
          jobRunId: jobRun.id,
          portalId: portalConfig.portalId,
          tenantId: tenant_id,
          baseUrl: portalConfig.baseUrl,
          confirmationNumber: result.confirmationNumber,
          details: (result as any).meta ?? undefined,
          payload,
          logger: jobLogger,
        });
      }
    } catch (e) {
      jobLogger.error({ err: e }, 'Booking notification failed');
    }

    try {
      await notifyAgentCompleted({
        jobId: job_id,
        jobRunId: jobRun.id,
        tenantId: tenant_id,
        portalId: portalConfig.portalId,
        agentId: agentId ?? null,
        agentName: agentName ?? null,
        status: 'completed',
        confirmationNumber: result.confirmationNumber,
        logger: jobLogger,
      });
    } catch (e) {
      jobLogger.warn({ err: e }, 'Agent completed notify failed');
    }

  } catch (err) {
    const kind = classifyError(err);
    if (runStartMs > 0) {
      metrics.gauge('dp_job_run_duration_ms').set(Date.now() - runStartMs);
    }
    metrics.counter('dp_job_errors_total', { kind }).inc(1);
    if (kind === 'soft') metrics.counter('dp_job_retries_total').inc(1);
    jobLogger.error({ err }, 'Job processing error');

    const terminalState = kind === 'hard' ? JOB_STATES.FAILED_TERMINAL : JOB_STATES.FAILED_RETRYABLE;
    await jobRepo.updateStatus(job_id, terminalState, {
      retry_count: payload.attempt_number - 1,
    });

    await eventRepo.createStateTransition(
      job_id,
      tenant_id,
      payload.resume_from_state ?? JOB_STATES.QUEUED,
      terminalState,
      { error: (err as Error).message, error_kind: kind },
      undefined
    );

    if (jobRun) {
      try {
        await notifyAgentFailed({
          jobId: job_id,
          jobRunId: jobRun.id,
          tenantId: tenant_id,
          portalId: (payload.portal_id as string) ?? 'unknown',
          agentId: agentId ?? null,
          agentName: agentName ?? null,
          finalStatus: terminalState,
          reason: (err as Error).message,
          logger: jobLogger,
        });
      } catch (e) {
        jobLogger.warn({ err: e }, 'Agent failed notify failed');
      }
    }

    throw err;
  } finally {
    // Release lock
    await jobRepo.releaseLock(job_id, workerId);
  }
}
