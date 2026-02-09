import type { JobState, HitlTaskType, JobConfig, HitlContext } from '@visa-automation/shared';
import { JOB_STATES, DEFAULTS } from '@visa-automation/shared';
import { db, HitlRepository } from '@visa-automation/db';

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
}

/**
 * Check if HITL should be triggered for the current state
 * Uses a simulated 20% chance for demo purposes
 */
export function shouldTriggerHitl(
  currentState: JobState,
  config?: JobConfig
): HitlCheckResult {
  // Only trigger HITL during certain states
  const hitlEligibleStates: JobState[] = [
    JOB_STATES.LOGIN_PROCESS,
    JOB_STATES.FORM_FILLING,
    JOB_STATES.PROCESSING,
  ];

  if (!hitlEligibleStates.includes(currentState)) {
    return { triggered: false };
  }

  // If simulate_hitl is explicitly set in config
  if (config?.simulate_hitl === true) {
    return {
      triggered: true,
      type: getHitlType(currentState),
      reason: 'Simulated HITL trigger (config)',
    };
  }

  // Random 20% chance for demo purposes
  const triggerChance = 0.2;
  if (Math.random() < triggerChance) {
    return {
      triggered: true,
      type: getHitlType(currentState),
      reason: 'Simulated HITL trigger (random)',
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
 * Create a HITL task in the database
 */
export async function createHitlTask(params: CreateHitlTaskParams): Promise<string> {
  const hitlRepo = new HitlRepository(db.instance);
  const hitlType = params.type;
  const hitlContext = params.context;
  // Calculate expiration (default 30 minutes)
  const expiresAt = new Date(Date.now() + DEFAULTS.HITL_TIMEOUT_MINUTES * 60 * 1000);

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
