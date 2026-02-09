import { Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import type { Redis as RedisType } from 'ioredis';
import { pino } from 'pino';
import { QUEUE_NAMES } from '@visa-automation/shared';
import type { JobQueuePayload } from '@visa-automation/shared';
import { processJob } from './processor.js';
import { closeDb } from '@visa-automation/db';
import { closeBrowser } from './core/browser/browser-manager.js';
import './portals/as-visa/index.js';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const LOG_LEVEL = LOG_LEVELS.includes(process.env.LOG_LEVEL as (typeof LOG_LEVELS)[number])
  ? (process.env.LOG_LEVEL as (typeof LOG_LEVELS)[number])
  : 'info';

const logger = pino({
  level: LOG_LEVEL,
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
});

const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10);

let worker: Worker | null = null;
let redisConnection: RedisType | null = null;

function getRedisConnection(): RedisType {
  if (!redisConnection) {
    redisConnection = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
    });
  }
  return redisConnection;
}

async function main() {
  logger.info({ workerId: WORKER_ID, concurrency: CONCURRENCY }, 'Starting worker');

  worker = new Worker<JobQueuePayload>(
    QUEUE_NAMES.JOB_PROCESSING,
    async (job) => {
      logger.info({ jobId: job.data.job_id, attemptNumber: job.data.attempt_number }, 'Processing job');
      
      try {
        await processJob(job.data, WORKER_ID, logger);
        logger.info({ jobId: job.data.job_id }, 'Job completed successfully');
      } catch (err) {
        logger.error({ jobId: job.data.job_id, err }, 'Job processing failed');
        throw err;
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: CONCURRENCY,
      limiter: {
        max: 10,
        duration: 1000, // Max 10 jobs per second
      },
    }
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.data.job_id }, 'Job marked as completed in queue');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.data.job_id, err: err.message }, 'Job failed in queue');
  });

  worker.on('error', (err) => {
    logger.error({ err }, 'Worker error');
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    
    if (worker) {
      await worker.close();
    }
    if (redisConnection) {
      await redisConnection.quit();
    }
    await closeBrowser();
    await closeDb();
    
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  logger.info('Worker started, waiting for jobs...');
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start worker');
  process.exit(1);
});
