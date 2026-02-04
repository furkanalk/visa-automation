import type { Logger } from 'pino';
import type { JobQueuePayload } from '@visa-automation/shared';
import { db, JobRepository, JobEventRepository, HitlRepository } from '@visa-automation/db';
import { runFSM } from './fsm/runner.js';
import { shouldTriggerHitl, createHitlTask } from './hitl/handler.js';
import { JOB_STATES } from '@visa-automation/shared';

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
  const hitlRepo = new HitlRepository(db.instance);

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

    // Run the FSM
    const result = await runFSM(payload, workerId, jobRun.id, logger);

    // Check if HITL was triggered
    if (result.hitlTriggered) {
      // Create HITL task
      await createHitlTask({
        job_id,
        job_run_id: jobRun.id,
        tenant_id,
        type: result.hitlType ?? 'CAPTCHA',
        context: result.hitlContext ?? { prompt: 'Please solve the captcha' },
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
