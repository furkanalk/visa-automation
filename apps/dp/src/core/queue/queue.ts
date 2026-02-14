import { Queue } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import type { Redis as RedisType } from 'ioredis';
import { QUEUE_NAMES } from '@visa-automation/shared';
import type { JobQueuePayload } from '@visa-automation/shared';
import { getConfigService } from '../../config/config-service.js';

let queue: Queue<JobQueuePayload> | null = null;
let redisConnection: RedisType | null = null;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`${name} is required (no default in production). Set it in environment.`);
  }
  return v;
}

function getRedisConnection(): RedisType {
  if (!redisConnection) {
    const host = requireEnv('REDIS_HOST');
    const port = parseInt(requireEnv('REDIS_PORT'), 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      throw new Error('REDIS_PORT must be a valid port number (1-65535).');
    }
    redisConnection = new IORedis({
      host,
      port,
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null, // Required by BullMQ
    });
  }
  return redisConnection;
}

export function getJobQueue(): Queue<JobQueuePayload> {
  if (!queue) {
    const q = getConfigService().get('queue');
    const completedMaxCount = q.completed_max_count ?? 1000;
    const failedMaxCount = q.failed_max_count ?? 5000;
    queue = new Queue<JobQueuePayload>(QUEUE_NAMES.JOB_PROCESSING, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: {
          age: 24 * 3600,
          count: completedMaxCount,
        },
        removeOnFail: {
          age: 7 * 24 * 3600,
          count: failedMaxCount,
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
