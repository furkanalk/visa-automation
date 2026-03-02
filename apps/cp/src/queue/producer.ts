import { Queue } from 'bullmq';
import { getDb, SystemSettingsRepository } from '@visa-automation/db';
import { QUEUE_NAMES } from '@visa-automation/shared';
import type { JobQueuePayload } from '@visa-automation/shared';

let queue: Queue<JobQueuePayload> | null = null;
let slotCheckQueue: Queue<JobQueuePayload> | null = null;
/** Per-agent SYNC queues — keyed by agentId */
const syncQueues = new Map<string, Queue<JobQueuePayload>>();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new Error(`${name} is required (no default in production). Set it in environment.`);
  }
  return v;
}

function getConnection() {
  const host = requireEnv('REDIS_HOST');
  const port = parseInt(requireEnv('REDIS_PORT'), 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error('REDIS_PORT must be a valid port number (1-65535).');
  }
  return {
    host,
    port,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  };
}

export async function getQueue(): Promise<Queue<JobQueuePayload>> {
  if (!queue) {
    const settingsRepo = new SystemSettingsRepository(getDb());
    const completedRetentionHours = await settingsRepo.getNumber(null, 'queue', 'completed_retention_hours', 24);
    const failedRetentionHours = await settingsRepo.getNumber(null, 'queue', 'failed_retention_hours', 168);
    const completedMaxCount = await settingsRepo.getNumber(null, 'queue', 'completed_max_count', 1000);
    const failedMaxCount = await settingsRepo.getNumber(null, 'queue', 'failed_max_count', 5000);

    queue = new Queue<JobQueuePayload>(QUEUE_NAMES.JOB_PROCESSING, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: completedRetentionHours * 3600, count: completedMaxCount },
        removeOnFail: { age: failedRetentionHours * 3600, count: failedMaxCount },
      },
    });
  }
  return queue;
}

export async function getSlotCheckQueue(): Promise<Queue<JobQueuePayload>> {
  if (!slotCheckQueue) {
    const settingsRepo = new SystemSettingsRepository(getDb());
    const completedRetentionHours = await settingsRepo.getNumber(null, 'queue', 'completed_retention_hours', 24);
    const failedRetentionHours = await settingsRepo.getNumber(null, 'queue', 'failed_retention_hours', 168);
    const completedMaxCount = await settingsRepo.getNumber(null, 'queue', 'completed_max_count', 1000);
    const failedMaxCount = await settingsRepo.getNumber(null, 'queue', 'failed_max_count', 5000);

    slotCheckQueue = new Queue<JobQueuePayload>(QUEUE_NAMES.SLOT_CHECK, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: completedRetentionHours * 3600, count: completedMaxCount },
        removeOnFail: { age: failedRetentionHours * 3600, count: failedMaxCount },
      },
    });
  }
  return slotCheckQueue;
}

export interface EnqueueOptions {
  /** When true, use a unique BullMQ jobId so the job is always added (for retry/requeue). */
  useUniqueId?: boolean;
}

export async function enqueueJob(
  payload: JobQueuePayload,
  options?: EnqueueOptions
): Promise<string> {
  const q = await getQueue();

  // Clamp priority to valid range [0, 100] to match DB constraint
  const clampedPriority = Math.max(0, Math.min(100, payload.priority));

  // Retry/requeue: use a unique BullMQ jobId so a new queue entry is created. BullMQ rejects
  // duplicate jobIds (returns existing job), so re-adding the same job_id would not make it "waiting".
  const attempt = payload.attempt_number ?? 1;
  const jobId =
    options?.useUniqueId || attempt > 1
      ? `${payload.job_id}-a${attempt}-${Date.now()}`
      : payload.job_id;

  const job = await q.add(
    `job-${payload.job_id}`,
    payload,
    {
      priority: 100 - clampedPriority, // BullMQ uses lower = higher priority
      jobId,
    }
  );

  return job.id ?? payload.job_id;
}

export interface EnqueueSlotCheckOptions {
  useUniqueId?: boolean;
}

/** Enqueue a slot-check (scout) job to the slot-check queue. Only scout agents consume from this queue. */
export async function enqueueSlotCheckJob(
  payload: JobQueuePayload,
  options?: EnqueueSlotCheckOptions
): Promise<string> {
  const q = await getSlotCheckQueue();
  const clampedPriority = Math.max(0, Math.min(100, payload.priority));
  const attempt = payload.attempt_number ?? 1;
  const jobId =
    options?.useUniqueId || attempt > 1
      ? `${payload.job_id}-a${attempt}-${Date.now()}`
      : payload.job_id;
  const job = await q.add(
    `job-${payload.job_id}`,
    payload,
    {
      priority: 100 - clampedPriority,
      jobId,
    }
  );
  return job.id ?? payload.job_id;
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (slotCheckQueue) {
    await slotCheckQueue.close();
    slotCheckQueue = null;
  }
}

/**
 * Get (or create) the dedicated BullMQ queue for a specific SYNC agent.
 * Queue name: "visa-sync__<agentId>"
 */
async function getSyncAgentQueue(agentId: string): Promise<Queue<JobQueuePayload>> {
  if (!syncQueues.has(agentId)) {
    const settingsRepo = new SystemSettingsRepository(getDb());
    const completedRetentionHours = await settingsRepo.getNumber(null, 'queue', 'completed_retention_hours', 24);
    const failedRetentionHours = await settingsRepo.getNumber(null, 'queue', 'failed_retention_hours', 168);
    const completedMaxCount = await settingsRepo.getNumber(null, 'queue', 'completed_max_count', 1000);
    const failedMaxCount = await settingsRepo.getNumber(null, 'queue', 'failed_max_count', 5000);

    const q = new Queue<JobQueuePayload>(QUEUE_NAMES.SYNC_AGENT_PREFIX + agentId, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: completedRetentionHours * 3600, count: completedMaxCount },
        removeOnFail: { age: failedRetentionHours * 3600, count: failedMaxCount },
      },
    });
    syncQueues.set(agentId, q);
  }
  return syncQueues.get(agentId)!;
}

/**
 * Enqueue a job directly to a specific SYNC agent's dedicated queue.
 * The SyncAgentRunner on DP subscribes each agent to "visa-sync__<agentId>".
 * This replaces the previous current_job_id polling mechanism.
 */
export async function enqueueSyncJob(
  agentId: string,
  payload: JobQueuePayload
): Promise<string> {
  const q = await getSyncAgentQueue(agentId);
  const clampedPriority = Math.max(0, Math.min(100, payload.priority));
  const job = await q.add(
    `sync-job-${payload.job_id}`,
    payload,
    {
      priority: 100 - clampedPriority,
      jobId: payload.job_id,
    }
  );
  return job.id ?? payload.job_id;
}
