import type { Logger } from 'pino';
import type { JobQueuePayload, JobState, HitlTaskType, HitlContext } from '@visa-automation/shared';
import { JOB_STATES, isValidTransition } from '@visa-automation/shared';
import { db, JobRepository, JobEventRepository } from '@visa-automation/db';
import { shouldTriggerHitl, getHitlPromptForState } from '../hitl/handler.js';
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

import { uploadScreenshotToCp } from '../upload-screenshot.js';

export interface FSMResult {
  success: boolean;
  lastState: JobState;
  hitlTriggered: boolean;
  hitlType?: HitlTaskType;
  hitlContext?: HitlContext;
  /** Set when slot-check-only job cannot continue (e.g. security code on page); no HITL is created */
  slotCheckAborted?: boolean;
  abortReason?: string;
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
  handlers: Partial<Record<JobState, StateHandler>>,
  /** From profile: fingerprint.enabled → consistent locale/timezone/userAgent */
  fingerprint?: { enabled?: boolean }
): Promise<FSMResult> {
  const jobRepo = new JobRepository(db.instance);
  const eventRepo = new JobEventRepository(db.instance);
  
  const { job_id, tenant_id, config } = payload;
  const slotCheckOnly = (config as Record<string, unknown> | undefined)?.slot_check_only === true;

  const jc = await createJobContext({ jobId: job_id, portalConfig, fingerprint });
  const throttler = new Throttler(portalConfig.pacing);
  const rateLimiter = new RateLimiter(portalConfig.rateLimit);

  // Slot-check jobs only need: open page → check calendar; no form fill, no processing (avoids security code etc.)
  const stateProgression: JobState[] = slotCheckOnly
    ? [
        JOB_STATES.QUEUED,
        JOB_STATES.LOGIN_PROCESS,
        JOB_STATES.LOGGED_IN,
        JOB_STATES.SLOT_SEARCHING,
        JOB_STATES.SLOT_FOUND,
        JOB_STATES.WAITING_SLOT,
        JOB_STATES.COMPLETED,
      ]
    : [
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

  // Start from payload resume state, or last persisted state (job_events), or QUEUED
  let currentState: JobState = payload.resume_from_state ?? JOB_STATES.QUEUED;
  if (!payload.resume_from_state) {
    const last = await eventRepo.findLatestStateForJob(job_id);
    if (last) {
      let resumeState: string | null = null;
      if (last.to_state === JOB_STATES.QUEUED && last.from_state === JOB_STATES.WAITING_HITL) {
        // Requeued after HITL resolve: last event is WAITING_HITL→QUEUED; resume from state we were in when we hit HITL
        const hitlTransition = await eventRepo.findLatestTransitionToState(job_id, JOB_STATES.WAITING_HITL);
        if (hitlTransition) resumeState = hitlTransition.from_state;
      } else if (last.to_state === JOB_STATES.WAITING_HITL) {
        resumeState = last.from_state;
      } else {
        resumeState = last.to_state;
      }
      if (resumeState && stateProgression.includes(resumeState as JobState)) {
        currentState = resumeState as JobState;
        logger.info({ jobId: job_id, resumeState: currentState }, 'Resuming FSM from last event');
      }
    }
  }

  let stateIndex = stateProgression.indexOf(currentState);
  if (stateIndex === -1) {
    stateIndex = 0;
    currentState = stateProgression[0];
  }

  logger.info(
    { jobId: job_id, startState: currentState, portalId: portalConfig.portalId, slotCheckOnly },
    'Starting FSM'
  );

  let lastMouseMoveAt = 0;
  const mouseMoveIntervalMs = portalConfig.mouseMoveIntervalMs ?? 0;

  try {
    // Progress through states
    while (stateIndex < stateProgression.length - 1) {
      // Optional: periodic human-like mouse wander (wavy, slightly shaky; options from portal config)
      if (mouseMoveIntervalMs > 0 && jc.page && !jc.page.isClosed()) {
        const now = Date.now();
        if (now - lastMouseMoveAt >= mouseMoveIntervalMs) {
          lastMouseMoveAt = now;
          humanLikeMouseMove(jc.page, portalConfig).catch(() => {});
        }
      }

      // STOP support: if job got cancelled externally, halt immediately
      const liveJob = await jobRepo.findById(job_id);
      if (liveJob?.status === JOB_STATES.CANCELLED && currentState !== JOB_STATES.CANCELLED) {
        // best-effort transition to CANCELLED (if valid)
        if (isValidTransition(currentState, JOB_STATES.CANCELLED)) {
          await jobRepo.updateStatus(job_id, JOB_STATES.CANCELLED);
          await eventRepo.createStateTransition(
            job_id,
            tenant_id,
            currentState,
            JOB_STATES.CANCELLED,
            { reason: 'Stopped by operator' },
            jobRunId
          );
        }
        return {
          success: true,
          lastState: JOB_STATES.CANCELLED,
          hitlTriggered: false,
        };
      }

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

      const screenshotFilename = `${currentState}.png`;
      const screenshotUrl = `/cp/screenshots/${job_id}/${screenshotFilename}`;
      try {
        const buf = await jc.page.screenshot({ type: 'png' });
        await uploadScreenshotToCp(tenant_id, job_id, screenshotFilename, buf);
      } catch (err) {
        logger.warn({ err, jobId: job_id }, 'Screenshot capture or upload failed');
      }

      const prompt = getHitlPromptForState(currentState, hitlCheck.type!);
      return {
        success: true,
        lastState: currentState,
        hitlTriggered: true,
        hitlType: hitlCheck.type,
        hitlContext: {
          prompt,
          screenshot_url: screenshotUrl,
          input_type: 'text',
          metadata: { state: currentState, reason: hitlCheck.reason },
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
      { worker_id: workerId },
      jobRunId
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

const MOUSE_MOVE_DEFAULTS = {
  segmentsMin: 10,
  segmentsMax: 16,
  jitterPx: 3,
  stepsMin: 6,
  stepsMax: 20,
  delayMinMs: 15,
  delayMaxMs: 42,
};

/** Human-like mouse movement: wavy, slightly shaky path; options from portal config (optional). */
async function humanLikeMouseMove(
  page: import('playwright').Page,
  portalConfig: Pick<
    PortalConfig,
    | 'mouseMoveSegmentsMin'
    | 'mouseMoveSegmentsMax'
    | 'mouseMoveJitterPx'
    | 'mouseMoveStepsMin'
    | 'mouseMoveStepsMax'
    | 'mouseMoveDelayMinMs'
    | 'mouseMoveDelayMaxMs'
  >
): Promise<void> {
  if (page.isClosed()) return;
  const v = page.viewportSize();
  if (!v || v.width < 50 || v.height < 50) {
    await page.mouse.move(10, 10, { steps: 5 }).catch(() => {});
    return;
  }
  const segMin = portalConfig.mouseMoveSegmentsMin ?? MOUSE_MOVE_DEFAULTS.segmentsMin;
  const segMax = Math.max(segMin, portalConfig.mouseMoveSegmentsMax ?? MOUSE_MOVE_DEFAULTS.segmentsMax);
  const jitterPx = portalConfig.mouseMoveJitterPx ?? MOUSE_MOVE_DEFAULTS.jitterPx;
  const stepsMin = portalConfig.mouseMoveStepsMin ?? MOUSE_MOVE_DEFAULTS.stepsMin;
  const stepsMax = Math.max(stepsMin, portalConfig.mouseMoveStepsMax ?? MOUSE_MOVE_DEFAULTS.stepsMax);
  const delayMin = portalConfig.mouseMoveDelayMinMs ?? MOUSE_MOVE_DEFAULTS.delayMinMs;
  const delayMax = Math.max(delayMin, portalConfig.mouseMoveDelayMaxMs ?? MOUSE_MOVE_DEFAULTS.delayMaxMs);

  const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
  const jitter = (maxPx: number) => (Math.random() - 0.5) * 2 * maxPx;
  const cx = Math.floor(v.width / 2);
  const cy = Math.floor(v.height / 2);
  const margin = 30;
  const xMin = margin;
  const yMin = margin;
  const xMax = v.width - margin;
  const yMax = v.height - margin;

  let x = cx + rand(-35, 35);
  let y = cy + rand(-35, 35);
  const points: { x: number; y: number }[] = [];
  const numPoints = Math.floor(rand(segMin, segMax + 1));

  for (let i = 0; i < numPoints; i++) {
    const stepX = (Math.random() - 0.5) * 2 * rand(12, 38);
    const stepY = (Math.random() - 0.5) * 2 * rand(12, 38);
    x += stepX;
    y += stepY;
    x = Math.max(xMin, Math.min(xMax, x));
    y = Math.max(yMin, Math.min(yMax, y));
    points.push({
      x: Math.round(x + jitter(jitterPx)),
      y: Math.round(y + jitter(jitterPx)),
    });
  }

  for (let i = 0; i < points.length; i++) {
    if (page.isClosed()) return;
    const pt = points[i];
    const steps = Math.floor(rand(stepsMin, stepsMax + 1));
    await page.mouse.move(pt.x, pt.y, { steps });
    await sleep(rand(delayMin, delayMax));
  }
}
