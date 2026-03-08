import type { JobState, HitlTaskType, JobConfig, HitlContext } from '@visa-automation/shared';
import { JOB_STATES } from '@visa-automation/shared';
import { db, HitlRepository, JobRepository, JobEventRepository } from '@visa-automation/db';
import { getConfigService } from '../../config/config-service.js';
import type { Logger } from 'pino';
import { notifyHitlRequired } from '../notify/index.js';

interface HitlCheckResult {
  triggered: boolean;
  type?: HitlTaskType;
  reason?: string;
}

interface CreateHitlTaskParams {
  job_id: string;
  job_run_id: string;
  tenant_id: string;
  type: HitlTaskType;
  context: HitlContext;
  /** If set, task expires in this many seconds (e.g. portal hitl.maxWaitSeconds). Else global task_timeout_minutes. */
  timeoutSeconds?: number;
}

export interface WaitForHitlParams {
  job_id: string;
  job_run_id: string;
  tenant_id: string;
  type: HitlTaskType;
  context: HitlContext;
  /** How long to wait for operator to resolve (seconds). Defaults to portal hitl.maxWaitSeconds or global timeout. */
  timeoutSeconds?: number;
  /** How often to poll for resolution (ms). Default: 2000 */
  pollIntervalMs?: number;
  /** Current FSM state (for job_event recording). */
  fromState: JobState;
  logger: Logger;
  /** Worker ID for lock renewal during the wait. If provided, lock is renewed every 60s. */
  workerId?: string;
}

/**
 * Thrown by waitForHitlResolution when the HITL task expires or is cancelled without resolution.
 * Callers should catch this specifically to transition the job to HITL_EXPIRED.
 */
export class HitlExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HitlExpiredError';
  }
}

/** Internal helper: mark the HITL task as EXPIRED in DB and transition job to HITL_EXPIRED. */
async function _markJobHitlExpired(p: {
  hitlRepo: HitlRepository;
  jobRepo: JobRepository;
  eventRepo: JobEventRepository;
  job_id: string;
  tenant_id: string;
  job_run_id: string;
  task_id: string;
  reason: string;
  logger: Logger;
}): Promise<void> {
  const { hitlRepo, jobRepo, eventRepo, job_id, tenant_id, job_run_id, task_id, reason, logger } = p;
  try {
    await hitlRepo.markExpired(task_id);
  } catch (err) {
    logger.warn({ err, taskId: task_id }, 'markExpired on HITL task failed (non-fatal)');
  }
  await jobRepo.updateStatus(job_id, JOB_STATES.HITL_EXPIRED);
  await eventRepo.createStateTransition(
    job_id,
    tenant_id,
    JOB_STATES.WAITING_HITL,
    JOB_STATES.HITL_EXPIRED,
    { reason, task_id },
    job_run_id
  );
  logger.warn({ jobId: job_id, taskId: task_id, reason }, 'HITL expired — job transitioned to HITL_EXPIRED');
}

/**
 * Inline HITL wait: create a HITL task, park the job at WAITING_HITL, and **block the current
 * async execution** (browser context stays alive!) until the operator resolves the task.
 *
 * Returns the resolution value entered by the operator (e.g. the 6-digit security code).
 * Throws an error if the task expires or times out before being resolved.
 *
 * This is the correct approach for cases where the browser page must stay open (security code
 * still on the page, no need to reload). The old approach of throwing FSMHalt + re-queuing
 * caused the page to reload → new random code → stale code mismatch.
 */
export async function waitForHitlResolution(params: WaitForHitlParams): Promise<string> {
  const {
    job_id,
    job_run_id,
    tenant_id,
    type,
    context,
    timeoutSeconds,
    pollIntervalMs = 2_000,
    fromState,
    logger,
    workerId,
  } = params;

  const hitlRepo = new HitlRepository(db.instance);
  const jobRepo = new JobRepository(db.instance);
  const eventRepo = new JobEventRepository(db.instance);

  // 1. Create HITL task
  const seconds =
    timeoutSeconds != null && timeoutSeconds > 0
      ? timeoutSeconds
      : getConfigService().get('hitl').task_timeout_minutes * 60;
  const expiresAt = new Date(Date.now() + seconds * 1000);

  const task = await hitlRepo.create({
    job_id,
    job_run_id,
    tenant_id,
    type,
    status: 'PENDING',
    context,
    expires_at: expiresAt,
  });

  logger.info({ jobId: job_id, taskId: task.id, type, expiresAt }, 'HITL task created — waiting inline (browser open)');

  // 2. Notify operator
  try {
    await notifyHitlRequired({
      jobId: job_id,
      hitlType: type,
      taskId: task.id,
      expiresSeconds: seconds,
      tenantId: tenant_id,
      logger,
    });
  } catch (err) {
    logger.warn({ err, jobId: job_id }, 'notifyHitlRequired failed (non-fatal)');
  }

  // 3. Park job at WAITING_HITL (UI feedback)
  await jobRepo.updateStatus(job_id, JOB_STATES.WAITING_HITL);
  await eventRepo.createStateTransition(
    job_id,
    tenant_id,
    fromState,
    JOB_STATES.WAITING_HITL,
    { reason: 'HITL triggered (inline wait)', hitl_type: type, task_id: task.id },
    job_run_id
  );

  // 4. Poll until resolved or expired — renew job lock every 60s so worker keeps ownership
  const deadline = Date.now() + seconds * 1_000 + 5_000; // +5s grace
  const LOCK_RENEW_INTERVAL_MS = 45_000; // renew every 45s (lock duration is 5min, gives 2 renewals before expiry)
  let lastLockRenewAt = Date.now();

  // Renew immediately on entry so that even if acquireLock was called just before status changed
  // to WAITING_HITL, the lock timestamp is fresh and CP's /resolve sees it as active-locked.
  if (workerId) {
    await jobRepo.renewLock(job_id, workerId, 5 * 60 * 1_000).catch((err) => {
      logger.warn({ err, jobId: job_id }, 'Initial lock renewal at HITL wait start failed (non-fatal)');
    });
    lastLockRenewAt = Date.now();
  }
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    // Renew lock periodically so the job is not claimed by another worker during the wait
    if (workerId && Date.now() - lastLockRenewAt >= LOCK_RENEW_INTERVAL_MS) {
      lastLockRenewAt = Date.now();
      await jobRepo.renewLock(job_id, workerId, 5 * 60 * 1_000).catch((err) => {
        logger.warn({ err, jobId: job_id }, 'Lock renewal failed during HITL wait (non-fatal)');
      });
    }

    const latest = await hitlRepo.findById(task.id);
    if (!latest) {
      throw new Error(`HITL task ${task.id} disappeared from DB during inline wait`);
    }

    if (latest.status === 'RESOLVED') {
      const value = (latest.resolution as Record<string, unknown> | null)?.value;
      const resolved = value != null ? String(value).trim() : '';
      logger.info({ jobId: job_id, taskId: task.id, hasValue: !!resolved }, 'HITL resolved (inline)');
      // Do NOT restore job status here — leave it at WAITING_HITL so that processor writes
      // a clean WAITING_HITL → COMPLETED transition (instead of COMPLETED → COMPLETED).
      return resolved;
    }

    if (latest.status === 'EXPIRED' || latest.status === 'CANCELLED') {
      await _markJobHitlExpired({ hitlRepo, jobRepo, eventRepo, job_id, tenant_id, job_run_id, task_id: task.id, reason: `HITL task ended with status ${latest.status}`, logger });
      throw new HitlExpiredError(`HITL task ${task.id} ended with status ${latest.status} before being resolved`);
    }

    logger.debug({ jobId: job_id, taskId: task.id, status: latest.status }, 'HITL still pending — polling');
  }

  // Deadline exceeded — mark expired in DB then signal caller
  await _markJobHitlExpired({ hitlRepo, jobRepo, eventRepo, job_id, tenant_id, job_run_id, task_id: task.id, reason: 'HITL deadline exceeded — operator did not respond in time', logger });
  throw new HitlExpiredError(`HITL task ${task.id} timed out (deadline exceeded) without resolution`);
}

/**
 * Check if HITL should be triggered for the current state.
 * Deterministic: only when config.simulate_hitl is true (for testing).
 * Real HITL (e.g. turnstile on page) is triggered from portal handlers, not here.
 */
export function shouldTriggerHitl(
  currentState: JobState,
  config?: JobConfig
): HitlCheckResult {
  const hitlEligibleStates: JobState[] = [
    JOB_STATES.LOGIN_PROCESS,
    JOB_STATES.FORM_FILLING,
    JOB_STATES.PROCESSING,
  ];

  if (!hitlEligibleStates.includes(currentState)) {
    return { triggered: false };
  }

  if (config?.simulate_hitl === true) {
    return {
      triggered: true,
      type: getHitlType(currentState),
      reason: 'Simulated HITL trigger (config.simulate_hitl)',
    };
  }

  return { triggered: false };
}

/**
 * Get the appropriate HITL type based on the current state
 */
export function getHitlType(state: JobState): HitlTaskType {
  switch (state) {
    case JOB_STATES.LOGIN_PROCESS:
      return 'TURNSTILE';
    case JOB_STATES.FORM_FILLING:
      return 'OTP';
    case JOB_STATES.PROCESSING:
      return 'MANUAL_REVIEW';
    default:
      return 'CAPTCHA';
  }
}

/**
 * Human-readable prompt and instruction for HITL based on state and type
 */
export function getHitlPromptForState(state: JobState, type: HitlTaskType): string {
  switch (type) {
    case 'TURNSTILE':
      return (
        'Turnstile/CAPTCHA detected on the login page. ' +
        'Complete the challenge in the screenshot (e.g. tick the checkbox or solve the puzzle). ' +
        'After solving it in the browser if needed, enter "done" or any required value in the resolution field.'
      );
    case 'OTP':
      return (
        'OTP or verification code requested during form filling. ' +
        'Enter the code received by the applicant (SMS/email) in the resolution field.'
      );
    case 'SECURITY_CODE':
      return (
        '6-digit security code (6 Haneli Kod) requested. ' +
        'Enter the code shown on the page or provided to the applicant in the resolution field.'
      );
    case 'CAPTCHA':
      return (
        'CAPTCHA detected. Check the screenshot, solve the CAPTCHA (e.g. enter the numbers/letters shown), ' +
        'and enter the result in the resolution field.'
      );
    case 'MANUAL_REVIEW':
      return (
        `Manual review at step "${state}". ` +
        'Check the screenshot; if there is a CAPTCHA, turnstile or verification, solve it and enter the result. ' +
        'Otherwise describe what you see or enter "skip" if nothing is required.'
      );
    default:
      return `Please resolve ${type} for this job. Check the screenshot and enter the result in the resolution field.`;
  }
}

/**
 * Create a HITL task in the database
 */
export async function createHitlTask(params: CreateHitlTaskParams): Promise<string> {
  const hitlRepo = new HitlRepository(db.instance);
  const hitlType = params.type;
  const hitlContext = params.context;
  const seconds =
    params.timeoutSeconds ?? getConfigService().get('hitl').task_timeout_minutes * 60;
  const expiresAt = new Date(Date.now() + seconds * 1000);

  const task = await hitlRepo.create({
    job_id: params.job_id,
    job_run_id: params.job_run_id,
    tenant_id: params.tenant_id,
    type: hitlType,
    status: 'PENDING',
    context: hitlContext,
    expires_at: expiresAt,
  });

  return task.id;
}

/**
 * Detect HITL scenarios from page content (stub)
 * In production, this would analyze screenshots/DOM for captchas, etc.
 */
export function detectHitlScenario(
  _pageContent: string,
  _screenshotPath?: string
): HitlCheckResult {
  // Stub implementation - in production would use ML/heuristics
  // to detect captchas, OTP prompts, etc.
  
  // Simulated detection keywords
  // const captchaKeywords = ['captcha', 'recaptcha', 'verify you are human'];
  // const otpKeywords = ['enter code', 'verification code', 'otp'];
  
  // For now, just return not triggered
  return { triggered: false };
}
