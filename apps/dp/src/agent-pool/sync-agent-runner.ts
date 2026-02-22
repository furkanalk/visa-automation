import type { Logger } from 'pino';
import type { AgentProfileConfig, JobQueuePayload } from '@visa-automation/shared';
import { AgentPool } from './agent-pool.js';
import type { AgentRuntime } from './types.js';

/**
 * SyncAgentRunner handles sync agents that are manually triggered via CP API.
 * It polls CP for job assignments and executes them.
 */
export class SyncAgentRunner {
  private agentPool: AgentPool;
  private logger: Logger;
  private processJob: (payload: JobQueuePayload, workerId: string, logger: Logger, profile?: AgentProfileConfig | null, agentId?: string | null, agentName?: string | null) => Promise<void>;
  private workerId: string;
  private pollInterval: NodeJS.Timeout | null = null;
  private pollIntervalMs: number;
  private runningJobs: Map<string, { agentId: string; abortController: AbortController }> = new Map();
  private isShuttingDown = false;

  constructor(options: {
    agentPool: AgentPool;
    logger: Logger;
    workerId: string;
    pollIntervalMs: number;
    processJob: (payload: JobQueuePayload, workerId: string, logger: Logger, profile?: AgentProfileConfig | null, agentId?: string | null, agentName?: string | null) => Promise<void>;
  }) {
    this.agentPool = options.agentPool;
    this.logger = options.logger.child({ component: 'SyncAgentRunner' });
    this.workerId = options.workerId;
    this.pollIntervalMs = options.pollIntervalMs;
    this.processJob = options.processJob;
  }

  /**
   * Start polling for sync agent jobs
   */
  async start(): Promise<void> {
    this.logger.info({ pollIntervalMs: this.pollIntervalMs }, 'Starting SyncAgentRunner');
    
    // Initial poll
    await this.pollForJobs();
    
    // Start polling interval
    this.pollInterval = setInterval(async () => {
      if (this.isShuttingDown) return;
      await this.pollForJobs();
    }, this.pollIntervalMs);

    this.logger.info('SyncAgentRunner started');
  }

  /**
   * Poll CP for sync agent job assignments
   */
  private async pollForJobs(): Promise<void> {
    const syncAgents = this.agentPool.getIdleSyncAgents();
    
    for (const agent of syncAgents) {
      try {
        // Refresh agent state from CP to check for job assignment
        const cpClient = this.agentPool.getCPClient();
        const cpAgent = await cpClient.getAgent(agent.id);
        
        if (!cpAgent) {
          this.logger.warn({ agentId: agent.id }, 'Agent not found in CP');
          continue;
        }

        // Check if CP assigned a job to this agent
        if (cpAgent.current_job_id && !agent.currentJobId) {
          this.logger.info({ agentId: agent.id, jobId: cpAgent.current_job_id }, 'Sync agent job assignment detected');
          
          // Fetch job details
          const job = await cpClient.getJob(cpAgent.current_job_id);
          if (!job) {
            this.logger.warn({ jobId: cpAgent.current_job_id }, 'Job not found, clearing assignment');
            continue;
          }

          // Execute the job
          await this.executeJob(agent, cpAgent.current_job_id, job as unknown as JobQueuePayload);
        }
      } catch (err) {
        this.logger.warn({ agentId: agent.id, err }, 'Error polling for sync agent job');
      }
    }
  }

  /**
   * Execute job with the sync agent
   */
  private async executeJob(
    agent: AgentRuntime,
    jobId: string,
    jobData: JobQueuePayload
  ): Promise<void> {
    const abortController = new AbortController();
    this.runningJobs.set(jobId, { agentId: agent.id, abortController });

    try {
      await this.agentPool.assignJob(agent.id, jobId);
      this.logger.info({ agentId: agent.id, jobId }, 'Starting sync job execution');

      // Check abort before starting
      if (abortController.signal.aborted) {
        this.logger.info({ jobId }, 'Job aborted before start');
        return;
      }

      // Job data from API should already be in correct format
      // Just ensure job_id and attempt_number are set
      const payload: JobQueuePayload = {
        ...jobData,
        job_id: jobId,
        attempt_number: jobData.attempt_number ?? 1,
      };

      await this.processJob(payload, this.workerId, this.logger, agent.profile ?? undefined, agent.id, agent.name ?? undefined);

      await this.agentPool.completeJob(agent.id, jobId);
      this.logger.info({ agentId: agent.id, jobId }, 'Sync job completed');
    } catch (err) {
      await this.agentPool.failJob(agent.id, jobId, err as Error);
      this.logger.error({ agentId: agent.id, jobId, err }, 'Sync job failed');
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  /**
   * Abort a running sync job
   */
  async abortJob(jobId: string): Promise<{ aborted: boolean; error?: string }> {
    const running = this.runningJobs.get(jobId);
    if (!running) {
      return { aborted: false, error: `Job ${jobId} not running on any sync agent` };
    }

    running.abortController.abort();
    this.logger.info({ jobId, agentId: running.agentId }, 'Sync job abort requested');
    return { aborted: true };
  }

  /**
   * Get status of sync agents
   */
  getStatus(): Array<{
    agentId: string;
    agentName: string;
    status: string;
    currentJobId: string | null;
  }> {
    return this.agentPool.getSyncAgents().map(a => ({
      agentId: a.id,
      agentName: a.name,
      status: a.status,
      currentJobId: a.currentJobId,
    }));
  }

  /**
   * Stop the runner
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Stopping SyncAgentRunner');
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Abort all running jobs
    for (const [jobId, running] of this.runningJobs) {
      running.abortController.abort();
      this.logger.info({ jobId, agentId: running.agentId }, 'Sync job aborted on shutdown');
    }
    this.runningJobs.clear();

    this.logger.info('SyncAgentRunner stopped');
  }
}
