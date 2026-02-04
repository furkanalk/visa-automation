import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { QUEUE_NAMES } from '@visa-automation/shared';
import type { JobQueuePayload } from '@visa-automation/shared';
import type { Redis as RedisType } from 'ioredis';

let queue: Queue | null = null;
let redisConnection: RedisType | null = null;

function getRedisConnection(): RedisType {
  if (!redisConnection) {
    redisConnection = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null, // Required by BullMQ
    });
  }
  return redisConnection!;
}

export function getQueue(): Queue<JobQueuePayload> {
  if (!queue) {
    queue = new Queue<JobQueuePayload>(QUEUE_NAMES.JOB_PROCESSING, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 1, // We handle retries at application level
        removeOnComplete: {
          age: 24 * 3600, // Keep completed jobs for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failed jobs for 7 days
          count: 5000,
        },
      },
    });
  }
  return queue;
}

export async function enqueueJob(payload: JobQueuePayload): Promise<string> {
  const q = getQueue();
  
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
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}
