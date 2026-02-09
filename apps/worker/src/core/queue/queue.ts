import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import type { Redis as RedisType } from 'ioredis';
import { QUEUE_NAMES } from '@visa-automation/shared';
import type { JobQueuePayload } from '@visa-automation/shared';

let queue: Queue<JobQueuePayload> | null = null;
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
  return redisConnection;
}

export function getJobQueue(): Queue<JobQueuePayload> {
  if (!queue) {
    queue = new Queue<JobQueuePayload>(QUEUE_NAMES.JOB_PROCESSING, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: {
          age: 24 * 3600,
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600,
          count: 5000,
        },
      },
    });
  }
  return queue;
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
