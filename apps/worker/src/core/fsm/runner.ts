import type { Logger } from 'pino';
import type { JobQueuePayload, JobState, HitlTaskType, HitlContext } from '@visa-automation/shared';
import { JOB_STATES, isValidTransition } from '@visa-automation/shared';
import { db, JobRepository, JobEventRepository } from '@visa-automation/db';
import { shouldTriggerHitl } from '../hitl/handler.js';
import { createJobContext } from '../browser/context-factory.js';
import { Throttler } from '../networking/throttler.js';
import { RateLimiter } from '../networking/rate-limiter.js';
import type { PortalDriver } from '../../portals/types.js';
import type { PortalConfig } from '../../config/types.js';

export interface FSMContext {
  jobId: string;
  tenantId: string;
  workerId: string;
  jobRunId: string;
  payload: JobQueuePayload;
  portal: PortalDriver;
  portalConfig: PortalConfig;
  throttler: Throttler;
  rateLimiter: RateLimiter;
  page: import('playwright').Page;
  logger: Logger;
}

export type StateHandler = (ctx: FSMContext) => Promise<void>;

export class FSMHalt extends Error {
  constructor(public result: Partial<FSMResult>) {
    super('FSM_HALTED');
    this.name = 'FSMHalt';
  }
}

export interface FSMResult {
  success: boolean;
  lastState: JobState;
  hitlTriggered: boolean;
  hitlType?: HitlTaskType;
  hitlContext?: HitlContext;
  confirmationNumber?: string;
  meta?: Record<string, unknown>;
  error?: string;
}

/**
 * Run the FSM for a job through all states until completion or HITL
 */
export async function runFSM(
  payload: JobQueuePayload,
  workerId: string,
  jobRunId: string,
  logger: Logger,
  portal: PortalDriver,
  portalConfig: PortalConfig,
  handlers: Partial<Record<JobState, StateHandler>>
): Promise<FSMResult> {
  const jobRepo = new JobRepository(db.instance);
  const eventRepo = new JobEventRepository(db.instance);
  
  const { job_id, tenant_id, config } = payload;
  
  const jc = await createJobContext({ jobId: job_id, portalConfig });
  const throttler = new Throttler(portalConfig.pacing);
  const rateLimiter = new RateLimiter(portalConfig.rateLimit);
  
  // Start from resume state or QUEUED
  let currentState: JobState = payload.resume_from_state ?? JOB_STATES.QUEUED;
  
  // Define the state progression for the vertical slice
  const stateProgression: JobState[] = [
    JOB_STATES.QUEUED,
    JOB_STATES.LOGIN_PROCESS,
    JOB_STATES.LOGGED_IN,
    JOB_STATES.FORM_FILLING,
    JOB_STATES.PROCESSING,
    JOB_STATES.SLOT_SEARCHING,
    JOB_STATES.SLOT_FOUND,
    JOB_STATES.WAITING_SLOT,
    JOB_STATES.COMPLETED,
  ];

  // Find where we are in the progression
  let stateIndex = stateProgression.indexOf(currentState);
  if (stateIndex === -1) {
    stateIndex = 0;
    currentState = stateProgression[0];
  }

  logger.info({ jobId: job_id, startState: currentState, portalId: portalConfig.portalId }, 'Starting FSM');

  try {
    // Progress through states
    while (stateIndex < stateProgression.length - 1) {
    const nextState = stateProgression[stateIndex + 1];
    
    // Validate transition
    if (!isValidTransition(currentState, nextState)) {
      logger.error({ 
        jobId: job_id, 
        from: currentState, 
        to: nextState 
      }, 'Invalid state transition');
      
      return {
        success: false,
        lastState: currentState,
        hitlTriggered: false,
        error: `Invalid transition from ${currentState} to ${nextState}`,
      };
    }

    // Check for HITL trigger (simulated)
    const hitlCheck = shouldTriggerHitl(currentState, config);
    if (hitlCheck.triggered) {
      logger.info({ 
        jobId: job_id, 
        state: currentState, 
        hitlType: hitlCheck.type 
      }, 'HITL triggered');

      return {
        success: true,
        lastState: currentState,
        hitlTriggered: true,
        hitlType: hitlCheck.type,
        hitlContext: {
          prompt: `Please resolve ${hitlCheck.type} for job`,
          screenshot_url: `/screenshots/${job_id}/${currentState}.png`,
          input_type: 'text',
        },
      };
    }

    // Execute state transition
    logger.info({ 
      jobId: job_id, 
      from: currentState, 
      to: nextState 
    }, 'State transition');

    const handler = handlers[nextState];
    if (handler) {
      await handler({
        jobId: job_id,
        tenantId: tenant_id,
        workerId,
        jobRunId,
        payload,
        portal,
        portalConfig,
        throttler,
        rateLimiter,
        page: jc.page,
        logger,
      });
    } else {
      logger.debug({ jobId: job_id, to: nextState }, 'No handler for state (skipping)');
    }

    // Update job status in database
    await jobRepo.updateStatus(job_id, nextState);
    
    // Log state transition event
    await eventRepo.createStateTransition(
      job_id,
      tenant_id,
      currentState,
      nextState,
      { worker_id: workerId, job_run_id: jobRunId }
    );

    currentState = nextState;
    stateIndex++;

    // Small delay to simulate processing (remove in production)
    await sleep(500);
  }

  // Generate a mock confirmation number
  const confirmationNumber = `VISA-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  return {
    success: true,
    lastState: currentState,
    hitlTriggered: false,
    confirmationNumber,
  };
  } catch (err) {
    if (err instanceof FSMHalt) {
      return {
        success: true,
        lastState: (err.result.lastState ?? currentState) as JobState,
        hitlTriggered: false,
        ...err.result,
      } satisfies FSMResult;
    }
    throw err;
  } finally {
    await jc.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
