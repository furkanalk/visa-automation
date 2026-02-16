import type { FastifyBaseLogger } from 'fastify';
import { getDb, JobRepository } from '@visa-automation/db';

const DEFAULT_INTERVAL_MS = 60_000; // 1 minute

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start a background loop that:
 * - Resets non-terminal jobs with expired lock to QUEUED (reclaimable again).
 * - Clears expired lock on QUEUED jobs (claimable again).
 * Call the returned stop() on shutdown.
 */
export function startStuckJobRecovery(
  logger: FastifyBaseLogger,
  intervalMs: number = DEFAULT_INTERVAL_MS
): () => void {
  if (intervalId) {
    logger.warn('Stuck-job recovery already running');
    return () => {};
  }

  const jobRepo = new JobRepository(getDb());

  const run = async () => {
    try {
      const runningCount = await jobRepo.resetStuckRunningJobs();
      if (runningCount > 0) {
        logger.info({ resetCount: runningCount }, 'Stuck-job recovery: reset jobs with expired lock to QUEUED');
      }
      const queuedCount = await jobRepo.clearExpiredLockOnQueuedJobs();
      if (queuedCount > 0) {
        logger.info({ resetCount: queuedCount }, 'Stuck-job recovery: cleared expired lock on QUEUED jobs');
      }
    } catch (err) {
      logger.error({ err }, 'Stuck-job recovery failed');
    }
  };

  run(); // run once on start
  intervalId = setInterval(run, intervalMs);
  logger.info({ intervalMs }, 'Stuck-job recovery started');

  return function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      logger.info('Stuck-job recovery stopped');
    }
  };
}
