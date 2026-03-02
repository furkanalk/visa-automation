import { Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import type { Logger } from 'pino';
import { QUEUE_NAMES } from '@visa-automation/shared';
import type { AgentProfileConfig, JobQueuePayload } from '@visa-automation/shared';
import { AgentPool } from './agent-pool.js';
import type { AgentRuntime } from './types.js';

/**
 * SyncAgentRunner: each SYNC agent gets a dedicated BullMQ queue
 * named "visa-sync__<agentId>". CP pushes jobs there directly.
 * No more CP polling — sub-100ms latency.
 */
export class SyncAgentRunner {
  private agentPool: AgentPool;
  private logger: Logger;
  private processJob: (
    payload: JobQueuePayload,
    workerId: string,
    logger: Logger,
    profile?: AgentProfileConfig | null,
    agentId?: string | null,
    agentName?: string | null,
  ) => Promise<void>;
  private workerId: string;
  /** One BullMQ Worker per SYNC agent */
  private workers: Map<string, Worker<JobQueuePayload>> = new Map();
  private runningJobs: Map<string, { agentId: string; abortController: AbortController }> = new Map();
  private isShuttingDown = false;
  private redisConnection: IORedis;

  constructor(options: {
    agentPool: AgentPool;
    logger: Logger;
    workerId: string;
    /** pollIntervalMs kept for API compatibility but no longer used */
    pollIntervalMs?: number;
    processJob: (
      payload: JobQueuePayload,
      workerId: string,
      logger: Logger,
      profile?: AgentProfileConfig | null,
      agentId?: string | null,
      agentName?: string | null,
    ) => Promise<void>;
    redisConnection: IORedis;
  }) {
    this.agentPool = options.agentPool;
    this.logger = options.logger.child({ component: 'SyncAgentRunner' });
    this.workerId = options.workerId;
    this.processJob = options.processJob;
    this.redisConnection = options.redisConnection;
  }

  /**
   * Start a BullMQ Worker for every currently-known SYNC agent,
   * then watch for new agents created later.
   */
  async start(): Promise<void> {
    this.logger.debug('Starting SyncAgentRunner (queue-based)');

    for (const agent of this.agentPool.getSyncAgents()) {
      this.subscribeAgent(agent);
    }

    this.agentPool.on('agent:created', (agent: AgentRuntime) => {
      if (agent.mode === 'SYNC') this.subscribeAgent(agent);
    });

    this.logger.debug({ agentCount: this.workers.size }, 'SyncAgentRunner started');
  }

  /** Create a BullMQ Worker that listens on "visa-sync__<agentId>" */
  private subscribeAgent(agent: AgentRuntime): void {
    if (this.workers.has(agent.id)) return;

    const queueName = QUEUE_NAMES.SYNC_AGENT_PREFIX + agent.id;
    this.logger.debug({ agentId: agent.id, agentName: agent.name, queueName }, 'Subscribing SYNC agent to queue');

    const worker = new Worker<JobQueuePayload>(
      queueName,
      async (bullJob) => {
        if (this.isShuttingDown) return;

        const payload = bullJob.data;
        const jobId = payload.job_id;

        // concurrency: 1 guarantees only one job runs at a time per worker,
        // so the agent is always IDLE when we get here.
        const agentRuntime = this.agentPool.getAgent(agent.id);
        if (!agentRuntime) {
          this.logger.warn({ agentId: agent.id, jobId }, 'SYNC agent runtime not found, skipping job');
          return; // BullMQ marks as complete — job stays in DB as QUEUED, operator can retry
        }

        // executeJob is awaited here so BullMQ holds the lock for the duration.
        // When it resolves/rejects the Worker handles lock release + job finalization.
        await this.executeJob(agentRuntime, jobId, payload);
      },
      {
        connection: this.redisConnection.duplicate(),
        concurrency: 1,
        autorun: true,
        lockDuration: 5 * 60 * 1000, // 5 min — long enough for a full browser session
        lockRenewTime: 60 * 1000,     // renew every 60s
      },
    );

    worker.on('failed', (bullJob, err) => {
      this.logger.error({ jobId: bullJob?.data?.job_id, agentId: agent.id, err }, 'Sync BullMQ job failed');
    });

    this.workers.set(agent.id, worker);
  }

  private async executeJob(
    agent: AgentRuntime,
    jobId: string,
    payload: JobQueuePayload,
  ): Promise<void> {
    const abortController = new AbortController();
    this.runningJobs.set(jobId, { agentId: agent.id, abortController });

    try {
      await this.agentPool.assignJob(agent.id, jobId);
      this.logger.debug({ agentId: agent.id, jobId }, 'Starting sync job execution');

      if (abortController.signal.aborted) {
        this.logger.debug({ jobId }, 'Sync job aborted before start');
        return;
      }

      await this.processJob(
        payload,
        this.workerId,
        this.logger,
        agent.profile ?? undefined,
        agent.id,
        agent.name ?? undefined,
      );

      await this.agentPool.completeJob(agent.id, jobId);
      this.logger.debug({ agentId: agent.id, jobId }, 'Sync job completed');
    } catch (err) {
      await this.agentPool.failJob(agent.id, jobId, err as Error);
      this.logger.error({ agentId: agent.id, jobId, err }, 'Sync job failed');
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  async abortJob(jobId: string): Promise<{ aborted: boolean; error?: string }> {
    const running = this.runningJobs.get(jobId);
    if (!running) {
      return { aborted: false, error: `Job ${jobId} not running on any sync agent` };
    }
    running.abortController.abort();
    this.logger.debug({ jobId, agentId: running.agentId }, 'Sync job abort requested');
    return { aborted: true };
  }

  getStatus(): Array<{ agentId: string; agentName: string; status: string; currentJobId: string | null }> {
    return this.agentPool.getSyncAgents().map((a) => ({
      agentId: a.id,
      agentName: a.name,
      status: a.status,
      currentJobId: a.currentJobId,
    }));
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.debug('Stopping SyncAgentRunner');

    for (const [jobId, running] of this.runningJobs) {
      running.abortController.abort();
      this.logger.debug({ jobId, agentId: running.agentId }, 'Sync job aborted on shutdown');
    }
    this.runningJobs.clear();

    await Promise.all([...this.workers.values()].map((w) => w.close()));
    this.workers.clear();

    this.logger.debug('SyncAgentRunner stopped');
  }
}
