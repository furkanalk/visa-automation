import type { JobQueuePayload } from '@visa-automation/shared';
import { randomInt } from 'node:crypto';
import { getJobQueue } from './queue.js';
import { getConfigService } from '../../config/config-service.js';

const JITTER_MS = 5000;

/**
 * Single source for slot retry: DP schedules via BullMQ here.
 * Exponential backoff: min_delay * 2^attempt, capped at max_delay, plus jitter.
 */
export async function scheduleSlotRetry(payload: JobQueuePayload): Promise<{ delayMs: number; skipped?: boolean }> {
  let minMs = 30_000;
  let maxMs = 90_000;
  let maxRetries = 3;
  try {
    const job = getConfigService().get('job');
    minMs = job.retry_slot_delay_min_ms ?? minMs;
    maxMs = job.retry_slot_delay_max_ms ?? maxMs;
    maxRetries = job.max_retries ?? maxRetries;
  } catch {
    // Config not initialized (e.g. tests); use defaults
  }

  const nextAttempt = payload.attempt_number + 1;
  if (nextAttempt > maxRetries) {
    return { delayMs: 0, skipped: true };
  }

  const exponential = minMs * Math.pow(2, payload.attempt_number);
  const capped = Math.min(maxMs, exponential);
  const delayMs = capped + randomInt(0, JITTER_MS);

  const queue = getJobQueue();
  await queue.add(
    'process-job',
    {
      ...payload,
      attempt_number: nextAttempt,
      resume_from_state: 'PROCESSING',
    },
    {
      delay: delayMs,
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  return { delayMs };
}
