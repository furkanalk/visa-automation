import type { Logger } from 'pino';
import type { JobQueuePayload } from '@visa-automation/shared';
import { db, JobRepository, JobEventRepository } from '@visa-automation/db';
import { runFSM } from './core/fsm/runner.js';
import { createHitlTask } from './core/hitl/handler.js';
import { JOB_STATES } from '@visa-automation/shared';
import { resolvePortalConfig } from './config/loader.js';
import { getPortal } from './portals/registry.js';
import { asVisaHandlers } from './portals/as-visa/fsm/handlers.js';
import { scheduleSlotRetry } from './core/queue/schedule-retry.js';
import { notifyBookingConfirmed } from './core/notify/index.js';
import { notifyJobCompletedEmail } from './core/notify/email.js';

/**
 * Main job processor - orchestrates the FSM execution
 */
export async function processJob(
  payload: JobQueuePayload,
  workerId: string,
  logger: Logger
): Promise<void> {
  const jobRepo = new JobRepository(db.instance);
  const eventRepo = new JobEventRepository(db.instance);

  const { job_id, tenant_id } = payload;

  // Acquire lock on the job
  const lockAcquired = await jobRepo.acquireLock(job_id, workerId, 5 * 60 * 1000); // 5 minute lock
  
  if (!lockAcquired) {
    logger.warn({ jobId: job_id }, 'Failed to acquire lock, job may be processed by another worker');
    return;
  }

  try {
    // Create job run record
    const jobRun = await db.instance
      .insertInto('job_runs')
      .values({
        job_id,
        tenant_id,
        worker_id: workerId,
        attempt_number: payload.attempt_number,
        status: 'RUNNING',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    logger.info({ jobId: job_id, runId: jobRun.id }, 'Created job run');

    // Resolve portal configuration (global + portal + tenant + job overrides)
    const portalId = payload.portal_id as any; // Type checked at API level
    const portalConfig = resolvePortalConfig({ portalId });
    const portal = getPortal(portalConfig.portalId);

    // Run portal automation (temporary hook; FSM integration coming next)
    const portalResult = await portal.run({
      jobId: job_id,
      tenantId: tenant_id,
      portalConfig,
      jobData: payload,
    });

    // Run the FSM (for state tracking/events - will be integrated with portal steps)
    const result = await runFSM(payload, workerId, jobRun.id, logger, portal, portalConfig, asVisaHandlers);

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
      logger.info({ jobId: job_id }, 'Job cancelled (STOP) - halted gracefully');
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
        { reason: 'Slot found (notified)', channel: 'telegram' }
      );

      await db.instance
        .updateTable('job_runs')
        .set({ status: 'COMPLETED', finished_at: new Date() })
        .where('id', '=', jobRun.id)
        .execute();

      logger.info({ jobId: job_id }, 'Job halted at SLOT_FOUND (MVP)');
      return;
    }

    // Check if job is waiting for a slot
    if (result.lastState === JOB_STATES.WAITING_SLOT) {
      const { delayMs } = await scheduleSlotRetry(payload);

      await eventRepo.createStateTransition(
        job_id,
        tenant_id,
        JOB_STATES.PROCESSING,
        JOB_STATES.WAITING_SLOT,
        { reason: 'No slots found', next_retry_ms: delayMs }
      );

      await db.instance
        .updateTable('job_runs')
        .set({ status: 'COMPLETED', finished_at: new Date() })
        .where('id', '=', jobRun.id)
        .execute();

      logger.info({ jobId: job_id, delayMs }, 'Job scheduled for slot retry');
      return;
    }

    // Check if HITL was triggered
    if (result.hitlTriggered) {
      // TODO: Add HITL notification in future iteration

      // Create HITL task
      await createHitlTask({
        job_id,
        job_run_id: jobRun.id,
        tenant_id,
        type: result.hitlType ?? 'CAPTCHA',
        context: result.hitlContext ?? { prompt: 'Please solve the captcha', input_type: 'text' },
      });

      // Update job status to WAITING_HITL
      await jobRepo.updateStatus(job_id, JOB_STATES.WAITING_HITL);
      
      // Log the state transition
      await eventRepo.createStateTransition(
        job_id,
        tenant_id,
        result.lastState,
        JOB_STATES.WAITING_HITL,
        { reason: 'HITL triggered', hitl_type: result.hitlType }
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

      logger.info({ jobId: job_id, hitlType: result.hitlType }, 'Job waiting for HITL');
      return;
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
      { confirmation_number: result.confirmationNumber }
    );

    // Update job run
    await db.instance
      .updateTable('job_runs')
      .set({ status: 'COMPLETED', finished_at: new Date() })
      .where('id', '=', jobRun.id)
      .execute();

    logger.info({ jobId: job_id, confirmationNumber: result.confirmationNumber }, 'Job completed');

    // Send completion email (optional if SMTP not configured)
    if (process.env.SMTP_HOST) {
      try {
        await notifyJobCompletedEmail({
          jobId: job_id,
          tenantId: tenant_id,
          portalId: portalConfig.portalId,
          confirmationNumber: result.confirmationNumber,
          logger,
        });
      } catch (e) {
        logger.warn({ jobId: job_id, err: e }, 'Job completion email failed');
      }
    }

    try {
      if (result.confirmationNumber) {
        await notifyBookingConfirmed({
          jobId: job_id,
          portalId: portalConfig.portalId,
          tenantId: tenant_id,
          baseUrl: portalConfig.baseUrl,
          confirmationNumber: result.confirmationNumber,
          details: (result as any).meta ?? undefined,
          payload,
          logger,
        });
      }
    } catch (e) {
      logger.error({ jobId: job_id, err: e }, 'Booking notification failed');
    }

  } catch (err) {
    logger.error({ jobId: job_id, err }, 'Job processing error');

    // Update job to failed state
    // retry_count semantics: "how many retries have occurred" (attempt_number - 1)
    await jobRepo.updateStatus(job_id, JOB_STATES.FAILED_RETRYABLE, {
      retry_count: payload.attempt_number - 1,
    });

    await eventRepo.createStateTransition(
      job_id,
      tenant_id,
      payload.resume_from_state ?? JOB_STATES.QUEUED,
      JOB_STATES.FAILED_RETRYABLE,
      { error: (err as Error).message }
    );

    throw err;
  } finally {
    // Release lock
    await jobRepo.releaseLock(job_id, workerId);
  }
}
