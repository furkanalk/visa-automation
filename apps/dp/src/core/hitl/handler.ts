import type { JobState, HitlTaskType, JobConfig, HitlContext } from '@visa-automation/shared';
import { JOB_STATES } from '@visa-automation/shared';
import { db, HitlRepository } from '@visa-automation/db';
import { getConfigService } from '../../config/config-service.js';

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
