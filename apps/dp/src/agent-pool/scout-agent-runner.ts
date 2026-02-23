import { Worker } from 'bullmq';
import type { Redis as RedisType } from 'ioredis';
import type { Logger } from 'pino';
import { QUEUE_NAMES } from '@visa-automation/shared';
import type { AgentProfileConfig, JobQueuePayload } from '@visa-automation/shared';
import { AgentPool } from './agent-pool.js';
import type { AgentRuntime } from './types.js';

const AGENT_WAIT_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * ScoutAgentRunner consumes from the slot-check queue only. When scout agents exist, only agents
 * with scout profile are used. When scoutCount is 0, useFallbackToAsyncAgents allows any idle
 * async agent to run slot-check jobs so watcher-created jobs are still processed.
 */
export class ScoutAgentRunner {
  private worker: Worker<JobQueuePayload> | null = null;
  private agentPool: AgentPool;
  private redis: RedisType;
  private logger: Logger;
  private processJob: (payload: JobQueuePayload, workerId: string, logger: Logger, profile?: AgentProfileConfig | null, agentId?: string | null, agentName?: string | null) => Promise<void>;
  private workerId: string;
  private useFallbackToAsyncAgents: boolean;

  constructor(options: {
    agentPool: AgentPool;
    redis: RedisType;
    logger: Logger;
    workerId: string;
    processJob: (payload: JobQueuePayload, workerId: string, logger: Logger, profile?: AgentProfileConfig | null, agentId?: string | null, agentName?: string | null) => Promise<void>;
    /** When true (e.g. scoutCount=0), use any idle async agent instead of scout-only. */
    useFallbackToAsyncAgents?: boolean;
  }) {
    this.agentPool = options.agentPool;
    this.redis = options.redis;
    this.logger = options.logger.child({ component: 'ScoutAgentRunner' });
    this.workerId = options.workerId;
    this.processJob = options.processJob;
    this.useFallbackToAsyncAgents = options.useFallbackToAsyncAgents ?? false;
  }

  async start(): Promise<void> {
    const stats = this.agentPool.getStats();
    const concurrency = this.useFallbackToAsyncAgents ? 1 : Math.max(1, stats.scoutCount);

    this.logger.debug(
      { concurrency, scoutCount: stats.scoutCount, useFallbackToAsyncAgents: this.useFallbackToAsyncAgents },
      'Starting ScoutAgentRunner'
    );

    this.worker = new Worker<JobQueuePayload>(
      QUEUE_NAMES.SLOT_CHECK,
      async (job) => {
        const agent = await this.waitForAvailableAgent(job.data.job_id, job.data.portal_id as string);
        if (!agent) {
          this.logger.error(
            { jobId: job.data.job_id },
            this.useFallbackToAsyncAgents ? 'No idle async agent available for slot-check after retries' : 'No idle scout agent available after retries'
          );
          throw new Error('No idle agent available for slot-check after max retries');
        }
        await this.executeJobWithAgent(agent, job.data);
      },
      {
        connection: this.redis,
        concurrency,
        limiter: { max: 10, duration: 1000 },
      }
    );

    this.worker.on('completed', (job) => {
      this.logger.debug({ jobId: job.data.job_id }, 'Scout job completed');
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.data.job_id, err: err.message }, 'Scout job failed');
    });
    this.worker.on('error', (err) => {
      this.logger.error({ err }, 'Scout worker error');
    });

    this.logger.debug('ScoutAgentRunner started');
  }

  private async waitForAvailableAgent(jobId: string, portalId: string): Promise<AgentRuntime | null> {
    let delay = AGENT_WAIT_CONFIG.initialDelayMs;
    for (let attempt = 0; attempt < AGENT_WAIT_CONFIG.maxRetries; attempt++) {
      const idle = this.useFallbackToAsyncAgents
        ? this.agentPool.getIdleAsyncAgents()
        : this.agentPool.getIdleScoutAgents();
      const agent = this.useFallbackToAsyncAgents
        ? (idle.find(a => this.agentPool.canAgentProcessPortal(a, portalId)) ?? idle[0] ?? null)
        : (idle[0] ?? null);
      if (agent) return agent;
      const stats = this.agentPool.getStats();
      const asyncScoutSummary = this.agentPool
        .getAllAgents()
        .filter((a) => a.mode === 'ASYNC')
        .map((a) => ({ id: a.id, name: a.name, status: a.status, is_scout: a.profile?.is_scout }));
      this.logger.debug(
        {
          jobId,
          attempt: attempt + 1,
          maxRetries: AGENT_WAIT_CONFIG.maxRetries,
          delayMs: delay,
          scoutCount: stats.scoutCount,
          asyncCount: stats.asyncCount,
          idleCount: stats.idle,
          runningCount: stats.running,
          asyncAgents: asyncScoutSummary,
        },
        this.useFallbackToAsyncAgents ? 'No async agent available for slot-check, waiting' : 'No scout agent available, waiting'
      );
      const jitter = Math.random() * 0.2 * delay;
      await new Promise(r => setTimeout(r, delay + jitter));
      delay = Math.min(delay * AGENT_WAIT_CONFIG.backoffMultiplier, AGENT_WAIT_CONFIG.maxDelayMs);
    }
    const stats = this.agentPool.getStats();
    const asyncScoutSummary = this.agentPool
      .getAllAgents()
      .filter((a) => a.mode === 'ASYNC')
      .map((a) => ({ id: a.id, name: a.name, status: a.status, is_scout: a.profile?.is_scout }));
    this.logger.warn(
      { jobId, scoutCount: stats.scoutCount, asyncCount: stats.asyncCount, asyncAgents: asyncScoutSummary },
      'No idle scout agent after retries; check that an ASYNC agent has a profile with is_scout=true and is IDLE'
    );
    return null;
  }

  private async executeJobWithAgent(agent: AgentRuntime, payload: JobQueuePayload): Promise<void> {
    const { job_id } = payload;
    try {
      await this.agentPool.assignJob(agent.id, job_id);
      this.logger.debug({ agentId: agent.id, jobId: job_id }, 'Starting scout job');
      const shouldAbort = await this.agentPool.shouldAbortJob(job_id);
      if (shouldAbort) {
        this.logger.debug({ jobId: job_id }, 'Scout job aborted before start');
        return;
      }
      await this.processJob(payload, this.workerId, this.logger, agent.profile ?? undefined, agent.id, agent.name ?? undefined);
      await this.agentPool.completeJob(agent.id, job_id);
    } catch (err) {
      await this.agentPool.failJob(agent.id, job_id, err as Error);
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.logger.debug('Stopping ScoutAgentRunner');
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    this.logger.debug('ScoutAgentRunner stopped');
  }
}
