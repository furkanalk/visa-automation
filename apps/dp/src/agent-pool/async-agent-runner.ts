import { Worker } from 'bullmq';
import type { Redis as RedisType } from 'ioredis';
import type { Logger } from 'pino';
import { QUEUE_NAMES } from '@visa-automation/shared';
import type { AgentProfileConfig, JobQueuePayload } from '@visa-automation/shared';
import { HitlWaitingError } from '../processor.js';
import { AgentPool } from './agent-pool.js';
import type { AgentRuntime } from './types.js';

// Config for agent availability retry
const AGENT_WAIT_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * AsyncAgentRunner manages BullMQ worker that dispatches jobs to async agents
 */
export class AsyncAgentRunner {
  private worker: Worker<JobQueuePayload> | null = null;
  private agentPool: AgentPool;
  private redis: RedisType;
  private logger: Logger;
  private processJob: (payload: JobQueuePayload, workerId: string, logger: Logger, profile?: AgentProfileConfig | null, agentId?: string | null, agentName?: string | null) => Promise<void>;
  private workerId: string;

  constructor(options: {
    agentPool: AgentPool;
    redis: RedisType;
    logger: Logger;
    workerId: string;
    processJob: (payload: JobQueuePayload, workerId: string, logger: Logger, profile?: AgentProfileConfig | null, agentId?: string | null, agentName?: string | null) => Promise<void>;
  }) {
    this.agentPool = options.agentPool;
    this.redis = options.redis;
    this.logger = options.logger.child({ component: 'AsyncAgentRunner' });
    this.workerId = options.workerId;
    this.processJob = options.processJob;
  }

  /**
   * Start the async agent runner
   */
  async start(): Promise<void> {
    const stats = this.agentPool.getStats();
    const concurrency = Math.max(1, (stats.asyncCount ?? 0) - (stats.scoutCount ?? 0));

    this.logger.debug({ concurrency, asyncCount: stats.asyncCount, scoutCount: stats.scoutCount }, 'Starting AsyncAgentRunner');

    this.worker = new Worker<JobQueuePayload>(
      QUEUE_NAMES.JOB_PROCESSING,
      async (job) => {
        const portalId = job.data.portal_id;
        const jobId = job.data.job_id;

        // Release any agent that was holding this job (e.g. after HITL requeue) so it can be picked up again
        this.agentPool.releaseJobFromAgent(jobId);

        // Try to find an available agent with retries
        const agent = await this.waitForAvailableAgent(portalId, jobId);
        if (!agent) {
          this.logger.error({ jobId: job.data.job_id, portalId }, 'No idle agent available after retries');
          throw new Error('No idle agent available for this portal after max retries');
        }

        await this.executeJobWithAgent(agent, job.data);
      },
      {
        connection: this.redis,
        concurrency,
        limiter: {
          max: 10,
          duration: 1000,
        },
      }
    );

    this.worker.on('completed', (job) => {
      this.logger.info({ jobId: job.data.job_id }, 'Job completed in queue');
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.data.job_id, err: err.message }, 'Job failed in queue');
    });

    this.worker.on('error', (err) => {
      this.logger.error({ err }, 'Worker error');
    });

    this.logger.debug('AsyncAgentRunner started');
  }

  /**
   * Wait for an available agent with exponential backoff
   */
  private async waitForAvailableAgent(
    portalId: string,
    jobId: string
  ): Promise<AgentRuntime | null> {
    let delay = AGENT_WAIT_CONFIG.initialDelayMs;

    for (let attempt = 0; attempt < AGENT_WAIT_CONFIG.maxRetries; attempt++) {
      const agent = this.findAvailableAgent(portalId);
      if (agent) {
        if (attempt > 0) {
          this.logger.debug(
            { jobId, portalId, attempt },
            'Found available agent after retry'
          );
        }
        return agent;
      }

      // Log and wait before next attempt
      this.logger.debug(
        { jobId, portalId, attempt: attempt + 1, maxRetries: AGENT_WAIT_CONFIG.maxRetries, delayMs: delay },
        'No agent available, waiting before retry'
      );

      // Wait with some jitter
      const jitter = Math.random() * 0.2 * delay; // 20% jitter
      await this.sleep(delay + jitter);

      // Exponential backoff
      delay = Math.min(delay * AGENT_WAIT_CONFIG.backoffMultiplier, AGENT_WAIT_CONFIG.maxDelayMs);
    }

    return null;
  }

  /**
   * Find an available agent for a portal
   */
  private findAvailableAgent(portalId: string): AgentRuntime | null {
    const idleAgents = this.agentPool.getIdleAsyncAgentsNonScout();
    const specificAgent = idleAgents.find(a => a.assignedPortals.includes(portalId));
    if (specificAgent) return specificAgent;
    const genericAgent = idleAgents.find(a => a.assignedPortals.length === 0);
    return genericAgent ?? null;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a job with a specific agent
   */
  private async executeJobWithAgent(
    agent: AgentRuntime,
    payload: JobQueuePayload
  ): Promise<void> {
    const { job_id } = payload;

    try {
      await this.agentPool.assignJob(agent.id, job_id);

      this.logger.info(
        { agentId: agent.id, jobId: job_id },
        'Starting job execution with agent'
      );

      // Process job with abort check
      await this.processJobWithAbortCheck(agent, payload);

      await this.agentPool.completeJob(agent.id, job_id);
    } catch (err) {
      if (err instanceof HitlWaitingError) {
        this.logger.info({ jobId: err.jobId, agentId: agent.id }, 'Job waiting for HITL; agent stays assigned');
        return;
      }
      await this.agentPool.failJob(agent.id, job_id, err as Error);
      throw err;
    }
  }

  /**
   * Process job with periodic abort check
   */
  private async processJobWithAbortCheck(
    agent: AgentRuntime,
    payload: JobQueuePayload
  ): Promise<void> {
    const shouldAbort = await this.agentPool.shouldAbortJob(payload.job_id);
    if (shouldAbort) {
      this.logger.debug({ jobId: payload.job_id }, 'Job aborted before start');
      return;
    }
    await this.processJob(payload, this.workerId, this.logger, agent.profile ?? undefined, agent.id, agent.name ?? undefined);
  }

  /**
   * Stop the runner
   */
  async stop(): Promise<void> {
    this.logger.debug('Stopping AsyncAgentRunner');
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    this.logger.debug('AsyncAgentRunner stopped');
  }

  /**
   * Update concurrency based on agent pool stats
   */
  async updateConcurrency(): Promise<void> {
    if (!this.worker) return;
    
    const stats = this.agentPool.getStats();
    const newConcurrency = stats.asyncCount || 1;
    
    // Note: BullMQ doesn't support dynamic concurrency change
    // Would need to restart worker for this
    this.logger.info({ newConcurrency }, 'Concurrency update requested (restart needed)');
  }
}
