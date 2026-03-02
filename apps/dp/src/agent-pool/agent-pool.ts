import { EventEmitter } from 'events';
import type { Logger } from 'pino';
import type { AgentProfileConfig } from '@visa-automation/shared';
import { CPClient } from './cp-client.js';
import type {
  AgentRuntime,
  AgentRuntimeStatus,
  AgentPoolConfig,
  HeartbeatResponse,
  AgentRegistrationResponse,
} from './types.js';

export class AgentPool extends EventEmitter {
  private agents: Map<string, AgentRuntime> = new Map();
  private cpClient: CPClient;
  private config: AgentPoolConfig;
  private logger: Logger;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private configRefreshInterval: NodeJS.Timeout | null = null;
  /** Separate from config: sync agent list from CP so Enable in Admin is picked up quickly. */
  private agentSyncInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private heartbeatInFlight = false;
  private profileCache: Map<string, AgentProfileConfig> = new Map();
  private portalCache: Map<string, Record<string, unknown>> = new Map();

  constructor(config: AgentPoolConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'AgentPool' });
    this.cpClient = new CPClient({
      baseUrl: config.cpApiUrl,
      publicApiUrl: config.publicApiUrl,
      tenantId: config.tenantId,
      logger: this.logger,
    });
  }

  async initialize(): Promise<void> {
    this.logger.debug('Initializing AgentPool');
    const cpHealthy = await this.cpClient.healthCheck();
    if (!cpHealthy) {
      this.logger.warn('CP API not reachable, will retry on heartbeat');
    } else {
      // Hydrate existing agents from CP on restart
      await this.hydrateFromCP();
    }
    await this.refreshConfig();
    this.startHeartbeat();
    this.startConfigRefresh();
    this.startAgentSync();
    this.logger.debug({ agentCount: this.agents.size }, 'AgentPool initialized');
  }

  /**
   * Hydrate local agent map from CP (restart recovery).
   * Only lists ONLINE and DRAINING agents (OFFLINE must not run).
   * Includes agents that belong to this worker (metadata.worker_id) and unclaimed agents
   * (no worker_id), e.g. created in Admin UI and set to ONLINE. Unclaimed get our worker_id
   * on first heartbeat so they are claimed by this worker.
   */
  private async hydrateFromCP(): Promise<void> {
    try {
      const existingAgents = await this.cpClient.listAgents({
        status: ['ONLINE', 'DRAINING'],
      });
      const metaOf = (a: AgentRegistrationResponse) => (a.metadata as { worker_id?: string } | undefined) ?? {};
      const workerAgents = existingAgents.filter(a => {
        const meta = metaOf(a);
        const claimedByUs = meta.worker_id === this.config.workerId;
        const unclaimed = meta.worker_id === undefined || meta.worker_id === null || meta.worker_id === '';
        return claimedByUs || unclaimed;
      });

      this.logger.debug(
        { count: workerAgents.length, total: existingAgents.length },
        'Hydrating existing agents from CP'
      );

      for (const cpAgent of workerAgents) {
        const runtime = await this.hydrateAgent(cpAgent);
        this.agents.set(runtime.id, runtime);
        this.logger.debug({ agentId: runtime.id, mode: runtime.mode, isScout: !!runtime.profile?.is_scout }, 'Agent hydrated');
      }
    } catch (err) {
      this.logger.warn({ err }, 'Failed to hydrate agents from CP (will create new ones)');
    }
  }

  private async hydrateAgent(cpAgent: AgentRegistrationResponse): Promise<AgentRuntime> {
    let profile: AgentProfileConfig | null = null;
    if (cpAgent.profile_id) {
      profile = await this.getProfile(cpAgent.profile_id);
    }

    const meta = (cpAgent.metadata as { worker_id?: string } | undefined) ?? {};
    const unclaimed = meta.worker_id === undefined || meta.worker_id === null || meta.worker_id === '';
    const metadata = unclaimed
      ? { worker_id: this.config.workerId, worker_pid: process.pid, started_at: new Date().toISOString() }
      : { ...meta };

    return {
      id: cpAgent.id,
      name: cpAgent.name,
      tenantId: this.config.tenantId,
      mode: cpAgent.mode,
      status: cpAgent.current_job_id ? 'RUNNING' : 'IDLE',
      profile,
      profileId: cpAgent.profile_id,
      assignedPortals: cpAgent.desired_portals,
      desiredConcurrency: cpAgent.desired_concurrency,
      currentJobId: cpAgent.current_job_id ?? null,
      lastHeartbeatAt: null,
      metadata,
    };
  }

  async createAgent(params: {
    name: string;
    mode: 'ASYNC' | 'SYNC';
    portals?: string[];
    concurrency?: number;
    profileId?: string;
  }): Promise<AgentRuntime> {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(`Max agent limit reached (${this.config.maxAgents})`);
    }
    this.logger.debug({ name: params.name, mode: params.mode, profileId: params.profileId }, 'Creating agent');

    let registration = await this.cpClient.getAgentByName(params.name);
    if (registration) {
      this.logger.debug({ agentId: registration.id, name: params.name }, 'Reusing existing agent');
    } else {
      registration = await this.cpClient.registerAgent({
        name: params.name,
        mode: params.mode,
        desiredPortals: params.portals,
        desiredConcurrency: params.concurrency,
        profileId: params.profileId,
        metadata: { worker_id: this.config.workerId, worker_pid: process.pid, started_at: new Date().toISOString() },
      });
    }

    let profile: AgentProfileConfig | null = null;
    if (registration.profile_id) {
      profile = await this.getProfile(registration.profile_id);
    }

    const runtime: AgentRuntime = {
      id: registration.id,
      name: registration.name,
      tenantId: this.config.tenantId,
      mode: registration.mode,
      status: 'IDLE',
      profile,
      profileId: registration.profile_id,
      assignedPortals: registration.desired_portals,
      desiredConcurrency: registration.desired_concurrency,
      currentJobId: registration.current_job_id ?? null,
      lastHeartbeatAt: null,
      metadata: registration.metadata ?? {
        worker_id: this.config.workerId,
        worker_pid: process.pid,
        started_at: new Date().toISOString(),
      },
    };

    this.agents.set(runtime.id, runtime);
    this.emit('agent:created', runtime);
    await this.cpClient.updateAgentStatus(runtime.id, 'ONLINE');
    this.logger.debug({ agentId: runtime.id, mode: runtime.mode }, 'Agent created');
    return runtime;
  }

  getAgent(agentId: string): AgentRuntime | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentRuntime[] {
    return Array.from(this.agents.values());
  }

  getIdleAsyncAgents(): AgentRuntime[] {
    return this.getAllAgents().filter(a => a.mode === 'ASYNC' && a.status === 'IDLE');
  }

  /** Idle ASYNC agents that are not scout (for main job queue) */
  getIdleAsyncAgentsNonScout(): AgentRuntime[] {
    return this.getIdleAsyncAgents().filter(a => !a.profile?.is_scout);
  }

  /** Idle ASYNC agents with scout profile (for slot-check queue) */
  getIdleScoutAgents(): AgentRuntime[] {
    return this.getIdleAsyncAgents().filter(a => a.profile?.is_scout === true);
  }

  getIdleSyncAgents(): AgentRuntime[] {
    return this.getAllAgents().filter(a => a.mode === 'SYNC' && a.status === 'IDLE');
  }

  getSyncAgents(): AgentRuntime[] {
    return this.getAllAgents().filter(a => a.mode === 'SYNC');
  }

  canAgentProcessPortal(agent: AgentRuntime, portalId: string): boolean {
    if (agent.assignedPortals.length === 0) return true;
    return agent.assignedPortals.includes(portalId);
  }

  async assignJob(agentId: string, jobId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    if (agent.status !== 'IDLE') {
      throw new Error(`Agent ${agentId} is not idle (status: ${agent.status})`);
    }
    agent.status = 'RUNNING';
    agent.currentJobId = jobId;
    this.emit('agent:job:started', agent, jobId);
    this.logger.debug({ agentId, jobId }, 'Job assigned to agent');
  }

  async completeJob(agentId: string, jobId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn({ agentId, jobId }, 'Agent not found when completing job');
      return;
    }
    const wasDraining = agent.status === 'DRAINING';
    agent.currentJobId = null;
    agent.status = wasDraining ? 'STOPPED' : 'IDLE';
    this.emit('agent:job:completed', agent, jobId);
    this.logger.debug({ agentId, jobId }, 'Job completed');
    // Tell CP immediately that this agent has no current job (so UI doesn't show stuck "Slot Found")
    try {
      await this.cpClient.sendHeartbeat({
        agentId,
        status: 'ONLINE',
        currentJobId: undefined,
        browserHealthy: true,
        metadata: agent.metadata,
      });
    } catch (err) {
      this.logger.warn({ agentId, err }, 'Failed to clear current_job_id in CP after complete');
    }
    if (wasDraining) {
      this.emit('agent:stopped', agent);
      this.logger.debug({ agentId }, 'Draining cooldown 5s, then setting OFFLINE in CP');
      await new Promise((r) => setTimeout(r, 5000));
      try {
        await this.cpClient.updateAgentStatus(agentId, 'OFFLINE');
        this.logger.debug({ agentId }, 'Draining complete, agent set to OFFLINE in CP');
      } catch (err) {
        this.logger.warn({ agentId, err }, 'Failed to set agent OFFLINE in CP after drain');
      }
    }
  }

  /**
   * Release any agent that is holding this job (e.g. after HITL requeue).
   * Call before finding an available agent so the same agent can pick the job up again.
   */
  releaseJobFromAgent(jobId: string): void {
    for (const agent of this.agents.values()) {
      if (agent.currentJobId === jobId) {
        agent.currentJobId = null;
        agent.status = agent.status === 'DRAINING' ? 'STOPPED' : 'IDLE';
        this.logger.debug({ agentId: agent.id, jobId }, 'Released job from agent (e.g. requeued after HITL)');
        return;
      }
    }
  }

  async failJob(agentId: string, jobId: string, error: Error): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      this.logger.warn({ agentId, jobId }, 'Agent not found when failing job');
      return;
    }
    const wasDraining = agent.status === 'DRAINING';
    agent.currentJobId = null;
    agent.status = wasDraining ? 'STOPPED' : 'IDLE';
    this.emit('agent:job:failed', agent, jobId, error);
    this.logger.error({ agentId, jobId, err: error }, 'Job failed');
    // Tell CP immediately that this agent has no current job
    try {
      await this.cpClient.sendHeartbeat({
        agentId,
        status: 'ONLINE',
        currentJobId: undefined,
        browserHealthy: true,
        metadata: agent.metadata,
      });
    } catch (err) {
      this.logger.warn({ agentId, err }, 'Failed to clear current_job_id in CP after fail');
    }
    if (wasDraining) {
      this.emit('agent:stopped', agent);
      this.logger.debug({ agentId }, 'Draining cooldown 5s (job failed), then setting OFFLINE in CP');
      await new Promise((r) => setTimeout(r, 5000));
      try {
        await this.cpClient.updateAgentStatus(agentId, 'OFFLINE');
        this.logger.info({ agentId }, 'Draining complete (job failed), agent set to OFFLINE in CP');
      } catch (err) {
        this.logger.warn({ agentId, err }, 'Failed to set agent OFFLINE in CP after drain');
      }
    }
  }

  updateAgentStatus(agentId: string, status: AgentRuntimeStatus): void {
    const agent = this.agents.get(agentId);
    if (agent) agent.status = status;
  }

  async drainAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    this.logger.debug({ agentId }, 'Draining agent');
    if (agent.currentJobId) {
      agent.status = 'DRAINING';
      await this.cpClient.updateAgentStatus(agentId, 'DRAINING');
    } else {
      agent.status = 'STOPPED';
      await this.cpClient.updateAgentStatus(agentId, 'OFFLINE');
      this.emit('agent:stopped', agent);
    }
  }

  async stopAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    this.logger.debug({ agentId }, 'Stopping agent');
    agent.status = 'STOPPED';
    await this.cpClient.updateAgentStatus(agentId, 'OFFLINE');
    this.emit('agent:stopped', agent);
  }

  async removeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.status === 'RUNNING') {
      throw new Error(`Cannot remove agent ${agentId} while running a job`);
    }
    await this.cpClient.updateAgentStatus(agentId, 'OFFLINE');
    this.agents.delete(agentId);
    this.logger.debug({ agentId }, 'Agent removed from pool');
  }

  async getProfile(profileId: string): Promise<AgentProfileConfig | null> {
    if (this.profileCache.has(profileId)) return this.profileCache.get(profileId)!;
    const profile = await this.cpClient.getProfile(profileId);
    if (profile) this.profileCache.set(profileId, profile);
    return profile;
  }

  async getPortalConfig(portalId: string): Promise<Record<string, unknown> | null> {
    if (this.portalCache.has(portalId)) return this.portalCache.get(portalId)!;
    const config = await this.cpClient.getPortalConfig(portalId);
    if (config) this.portalCache.set(portalId, config);
    return config;
  }

  async shouldAbortJob(jobId: string): Promise<boolean> {
    const status = await this.cpClient.checkJobStatus(jobId);
    return status?.shouldAbort ?? false;
  }

  getCPClient(): CPClient {
    return this.cpClient;
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      if (this.isShuttingDown) return;
      if (this.heartbeatInFlight) return; // Prevent overlapping heartbeats
      
      this.heartbeatInFlight = true;
      try {
        for (const agent of this.agents.values()) {
          if (agent.status === 'STOPPED') continue;
          try {
            const cpStatus = agent.status === 'RUNNING' ? 'ONLINE' : 
                            agent.status === 'DRAINING' ? 'DRAINING' : 'ONLINE';
            const response = await this.cpClient.sendHeartbeat({
              agentId: agent.id,
              status: cpStatus,
              currentJobId: agent.currentJobId ?? undefined,
              browserHealthy: true,
              metadata: agent.metadata,
            });
            agent.lastHeartbeatAt = new Date();
            if (response.disabled) {
              agent.status = 'STOPPED';
              this.logger.debug({ agentId: agent.id }, 'Agent disabled by admin, marked STOPPED');
            } else if (response.draining) {
              agent.status = 'DRAINING';
              this.logger.debug({ agentId: agent.id }, 'Agent set to DRAINING by CP (finish current job then OFFLINE)');
            } else if (response.config_changed) {
              await this.handleConfigChange(agent, response);
            }
          } catch (err) {
            this.logger.warn({ agentId: agent.id, err }, 'Heartbeat failed');
          }
        }
      } finally {
        this.heartbeatInFlight = false;
      }
    }, this.config.heartbeatIntervalMs);
  }

  private async handleConfigChange(agent: AgentRuntime, response: HeartbeatResponse): Promise<void> {
    this.logger.debug({ agentId: agent.id }, 'Config changed, updating agent');
    if (response.profile) {
      agent.profile = response.profile;
      if (agent.profileId) this.profileCache.set(agent.profileId, response.profile);
    }
    if (response.desired_portals) agent.assignedPortals = response.desired_portals;
    if (response.desired_concurrency) agent.desiredConcurrency = response.desired_concurrency;
  }

  private startConfigRefresh(): void {
    this.configRefreshInterval = setInterval(async () => {
      if (this.isShuttingDown) return;
      await this.refreshConfig();
    }, this.config.configRefreshIntervalMs);
  }

  private async refreshConfig(): Promise<void> {
    try {
      const portals = await this.cpClient.getEnabledPortals();
      for (const portal of portals) {
        this.portalCache.set(portal.portal_id, portal.config);
      }
      const defaultProfile = await this.cpClient.getDefaultProfile();
      if (defaultProfile) this.profileCache.set(defaultProfile.id, defaultProfile.config);
      this.emit('config:refreshed');
    } catch (err) {
      this.logger.warn({ err }, 'Config refresh failed');
    }
  }

  /** Run every 15s so Enable in CP is reflected in DP within seconds. */
  private startAgentSync(): void {
    const AGENT_SYNC_MS = 15_000;
    this.agentSyncInterval = setInterval(async () => {
      if (this.isShuttingDown) return;
      await this.syncAgentsFromCP();
    }, AGENT_SYNC_MS);
  }

  /**
   * Add any ONLINE/DRAINING agents from CP that we don't have in the pool yet;
   * and re-enable STOPPED agents when CP says they are ONLINE again (user clicked Enable).
   * So heartbeat resumes and the agent does not time out to OFFLINE.
   */
  private async syncAgentsFromCP(): Promise<void> {
    try {
      const existingAgents = await this.cpClient.listAgents({
        status: ['ONLINE', 'DRAINING'],
      });
      const metaOf = (a: AgentRegistrationResponse) => (a.metadata as { worker_id?: string } | undefined) ?? {};
      const workerOrUnclaimed = existingAgents.filter(a => {
        const meta = metaOf(a);
        const claimedByUs = meta.worker_id === this.config.workerId;
        const unclaimed = meta.worker_id === undefined || meta.worker_id === null || meta.worker_id === '';
        return claimedByUs || unclaimed;
      });

      const cpAgentIds = new Set(workerOrUnclaimed.map((a) => a.id));

      // Re-enable STOPPED agents that CP says are ONLINE/DRAINING (user re-enabled in Admin)
      for (const agent of this.agents.values()) {
        if (agent.status === 'STOPPED' && cpAgentIds.has(agent.id)) {
          agent.status = 'IDLE';
          agent.currentJobId = null;
          this.logger.info({ agentId: agent.id, name: agent.name }, 'Agent re-enabled (CP is ONLINE, resuming heartbeat)');
        }
      }

      for (const cpAgent of workerOrUnclaimed) {
        if (this.agents.has(cpAgent.id)) continue;
        if (this.agents.size >= this.config.maxAgents) break;
        const runtime = await this.hydrateAgent(cpAgent);
        this.agents.set(runtime.id, runtime);
        this.logger.info(
          { agentId: runtime.id, name: runtime.name, mode: runtime.mode, isScout: !!runtime.profile?.is_scout },
          'Agent added to pool (was enabled in CP after DP started)'
        );
        // Notify runners (e.g. SyncAgentRunner) so they can subscribe to this agent's queue.
        this.emit('agent:created', runtime);
      }
    } catch (err) {
      this.logger.warn({ err }, 'Sync agents from CP failed');
    }
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.debug('Shutting down AgentPool');
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.configRefreshInterval) clearInterval(this.configRefreshInterval);
    if (this.agentSyncInterval) clearInterval(this.agentSyncInterval);
    const drainPromises = Array.from(this.agents.values()).map(async agent => {
      try {
        if (agent.currentJobId) await this.drainAgent(agent.id);
        else await this.stopAgent(agent.id);
      } catch (err) {
        this.logger.warn({ agentId: agent.id, err }, 'Error stopping agent');
      }
    });
    await Promise.all(drainPromises);
    this.agents.clear();
    this.logger.debug('AgentPool shutdown complete');
  }

  getStats(): {
    total: number;
    idle: number;
    running: number;
    draining: number;
    stopped: number;
    asyncCount: number;
    syncCount: number;
    scoutCount: number;
  } {
    const agents = this.getAllAgents();
    const asyncAgents = agents.filter(a => a.mode === 'ASYNC');
    return {
      total: agents.length,
      idle: agents.filter(a => a.status === 'IDLE').length,
      running: agents.filter(a => a.status === 'RUNNING').length,
      draining: agents.filter(a => a.status === 'DRAINING').length,
      stopped: agents.filter(a => a.status === 'STOPPED').length,
      asyncCount: asyncAgents.length,
      syncCount: agents.filter(a => a.mode === 'SYNC').length,
      scoutCount: asyncAgents.filter(a => a.profile?.is_scout === true).length,
    };
  }
}
