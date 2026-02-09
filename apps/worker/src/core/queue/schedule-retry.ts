import type { JobQueuePayload } from '@visa-automation/shared';
import { randomInt } from 'node:crypto';
import { getJobQueue } from './queue.js';

export async function scheduleSlotRetry(payload: JobQueuePayload) {
  // 30-90s jitter (ban riskini azaltır)
  const delayMs = randomInt(30_000, 90_000);

  const queue = getJobQueue();
  await queue.add(
    'process-job',
    {
      ...payload,
      attempt_number: payload.attempt_number + 1,
      resume_from_state: 'PROCESSING', // tekrar slot-hunt state'inden başlasın
    },
    {
      delay: delayMs,
      removeOnComplete: true,
      removeOnFail: true,
    }
  );

  return { delayMs };
}
