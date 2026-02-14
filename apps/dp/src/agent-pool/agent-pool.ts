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
    this.logger.info('Initializing AgentPool');
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
    this.logger.info({ agentCount: this.agents.size }, 'AgentPool initialized');
  }

  /**
   * Hydrate local agent map from CP (restart recovery)
   * Only hydrates agents that belong to this worker
   */
  private async hydrateFromCP(): Promise<void> {
    try {
      const existingAgents = await this.cpClient.listAgents({ status: ['ONLINE', 'DRAINING'] });
      const workerAgents = existingAgents.filter(a => 
        a.name.startsWith(this.config.workerId)
      );

      this.logger.info({ count: workerAgents.length }, 'Hydrating existing agents from CP');

      for (const cpAgent of workerAgents) {
        const runtime = await this.hydrateAgent(cpAgent);
        this.agents.set(runtime.id, runtime);
        this.logger.info({ agentId: runtime.id, mode: runtime.mode }, 'Agent hydrated');
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
      metadata: {},
    };
  }

  async createAgent(params: {
    name: string;
    mode: 'ASYNC' | 'SYNC';
    portals?: string[];
    concurrency?: number;
  }): Promise<AgentRuntime> {
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(`Max agent limit reached (${this.config.maxAgents})`);
    }
    this.logger.info({ name: params.name, mode: params.mode }, 'Creating agent');

    const registration = await this.cpClient.registerAgent({
      name: params.name,
      mode: params.mode,
      desiredPortals: params.portals,
      desiredConcurrency: params.concurrency,
      metadata: { worker_id: this.config.workerId, worker_pid: process.pid, started_at: new Date().toISOString() },
    });

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
      currentJobId: null,
      lastHeartbeatAt: null,
      metadata: registration.metadata ?? { 
        worker_id: this.config.workerId, 
        worker_pid: process.pid, 
        started_at: new Date().toISOString() 
      },
    };

    this.agents.set(runtime.id, runtime);
    this.emit('agent:created', runtime);
    await this.cpClient.updateAgentStatus(runtime.id, 'ONLINE');
    this.logger.info({ agentId: runtime.id, mode: runtime.mode }, 'Agent created');
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
    this.logger.info({ agentId, jobId }, 'Job assigned to agent');
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
    this.logger.info({ agentId, jobId }, 'Job completed');
    if (wasDraining) this.emit('agent:stopped', agent);
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
    if (wasDraining) this.emit('agent:stopped', agent);
  }

  updateAgentStatus(agentId: string, status: AgentRuntimeStatus): void {
    const agent = this.agents.get(agentId);
    if (agent) agent.status = status;
  }

  async drainAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    this.logger.info({ agentId }, 'Draining agent');
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
    this.logger.info({ agentId }, 'Stopping agent');
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
    this.logger.info({ agentId }, 'Agent removed from pool');
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
            if (response.config_changed) await this.handleConfigChange(agent, response);
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
    this.logger.info({ agentId: agent.id }, 'Config changed, updating agent');
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

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Shutting down AgentPool');
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.configRefreshInterval) clearInterval(this.configRefreshInterval);
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
    this.logger.info('AgentPool shutdown complete');
  }

  getStats(): {
    total: number;
    idle: number;
    running: number;
    draining: number;
    stopped: number;
    asyncCount: number;
    syncCount: number;
  } {
    const agents = this.getAllAgents();
    return {
      total: agents.length,
      idle: agents.filter(a => a.status === 'IDLE').length,
      running: agents.filter(a => a.status === 'RUNNING').length,
      draining: agents.filter(a => a.status === 'DRAINING').length,
      stopped: agents.filter(a => a.status === 'STOPPED').length,
      asyncCount: agents.filter(a => a.mode === 'ASYNC').length,
      syncCount: agents.filter(a => a.mode === 'SYNC').length,
    };
  }
}
