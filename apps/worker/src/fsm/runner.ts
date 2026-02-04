import type { Logger } from 'pino';
import type { JobQueuePayload, JobState, HitlTaskType } from '@visa-automation/shared';
import { JOB_STATES, isValidTransition } from '@visa-automation/shared';
import { db, JobRepository, JobEventRepository } from '@visa-automation/db';
import { shouldTriggerHitl, getHitlType } from '../hitl/handler.js';

export interface FSMResult {
  success: boolean;
  lastState: JobState;
  hitlTriggered: boolean;
  hitlType?: HitlTaskType;
  hitlContext?: Record<string, unknown>;
  confirmationNumber?: string;
  error?: string;
}

/**
 * Run the FSM for a job through all states until completion or HITL
 */
export async function runFSM(
  payload: JobQueuePayload,
  workerId: string,
  jobRunId: string,
  logger: Logger
): Promise<FSMResult> {
  const jobRepo = new JobRepository(db.instance);
  const eventRepo = new JobEventRepository(db.instance);
  
  const { job_id, tenant_id, config } = payload;
  
  // Start from resume state or QUEUED
  let currentState: JobState = payload.resume_from_state ?? JOB_STATES.QUEUED;
  
  // Define the state progression for the vertical slice
  const stateProgression: JobState[] = [
    JOB_STATES.QUEUED,
    JOB_STATES.LOGIN_PROCESS,
    JOB_STATES.LOGGED_IN,
    JOB_STATES.FORM_FILLING,
    JOB_STATES.PROCESSING,
    JOB_STATES.COMPLETED,
  ];

  // Find where we are in the progression
  let stateIndex = stateProgression.indexOf(currentState);
  if (stateIndex === -1) {
    stateIndex = 0;
    currentState = stateProgression[0];
  }

  logger.info({ jobId: job_id, startState: currentState }, 'Starting FSM');

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
          input_type: hitlCheck.type === 'CAPTCHA' ? 'text' : 'text',
        },
      };
    }

    // Execute state transition (stub - in real implementation, this runs Playwright)
    logger.info({ 
      jobId: job_id, 
      from: currentState, 
      to: nextState 
    }, 'State transition');

    await executeStateTransition(job_id, currentState, nextState, logger);

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
}

/**
 * Execute a single state transition (stub implementation)
 * In production, this would run Playwright automation
 */
async function executeStateTransition(
  jobId: string,
  fromState: JobState,
  toState: JobState,
  logger: Logger
): Promise<void> {
  // Stub implementations for each state
  switch (toState) {
    case JOB_STATES.LOGIN_PROCESS:
      logger.debug({ jobId }, 'Stub: Navigating to login page');
      await sleep(200);
      break;
    
    case JOB_STATES.LOGGED_IN:
      logger.debug({ jobId }, 'Stub: Submitting login credentials');
      await sleep(300);
      break;
    
    case JOB_STATES.FORM_FILLING:
      logger.debug({ jobId }, 'Stub: Filling application form');
      await sleep(400);
      break;
    
    case JOB_STATES.PROCESSING:
      logger.debug({ jobId }, 'Stub: Submitting application');
      await sleep(500);
      break;
    
    case JOB_STATES.COMPLETED:
      logger.debug({ jobId }, 'Stub: Application completed');
      break;
    
    default:
      logger.debug({ jobId, toState }, 'Stub: Generic state transition');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
