import { Queue } from 'bullmq';
import { getDb, SystemSettingsRepository } from '@visa-automation/db';
import { QUEUE_NAMES } from '@visa-automation/shared';
import type { JobQueuePayload } from '@visa-automation/shared';

let queue: Queue<JobQueuePayload> | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`${name} is required (no default in production). Set it in environment.`);
  }
  return v;
}

export async function getQueue(): Promise<Queue<JobQueuePayload>> {
  if (!queue) {
    const host = requireEnv('REDIS_HOST');
    const port = parseInt(requireEnv('REDIS_PORT'), 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      throw new Error('REDIS_PORT must be a valid port number (1-65535).');
    }
    const settingsRepo = new SystemSettingsRepository(getDb());
    const completedMaxCount = await settingsRepo.getNumber(null, 'queue', 'completed_max_count', 1000);
    const failedMaxCount = await settingsRepo.getNumber(null, 'queue', 'failed_max_count', 5000);

    queue = new Queue<JobQueuePayload>(QUEUE_NAMES.JOB_PROCESSING, {
      connection: {
        host,
        port,
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: {
        attempts: 1, // We handle retries at application level
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: completedMaxCount,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
          count: failedMaxCount,
        },
      },
    });
  }
  return queue;
}

export async function enqueueJob(payload: JobQueuePayload): Promise<string> {
  const q = await getQueue();

  // Clamp priority to valid range [0, 100] to match DB constraint
  const clampedPriority = Math.max(0, Math.min(100, payload.priority));

  const job = await q.add(
    `job-${payload.job_id}`,
    payload,
    {
      priority: 100 - clampedPriority, // BullMQ uses lower = higher priority
      jobId: payload.job_id, // Use job_id as BullMQ job ID for deduplication
    }
  );

  return job.id ?? payload.job_id;
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
