import type { Logger } from 'pino';
import type { 
  AgentMode, 
  AgentStatus, 
  AgentProfileConfig,
  AgentMetadata,
} from '@visa-automation/shared';
import type { 
  AgentRegistrationResponse, 
  HeartbeatResponse,
} from './types.js';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface ApiError {
  error?: { message?: string };
  message?: string;
}

export class CPClient {
  private baseUrl: string;
  private publicApiUrl: string;
  private tenantId: string;
  private logger: Logger;
  private actorType = 'agent';

  constructor(options: { baseUrl: string; publicApiUrl: string; tenantId: string; logger: Logger }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.publicApiUrl = options.publicApiUrl.replace(/\/$/, '');
    this.tenantId = options.tenantId;
    this.logger = options.logger.child({ component: 'CPClient' });
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-tenant-id': this.tenantId,
      'x-actor-type': this.actorType,
    };
  }

  private async parseError(response: Response): Promise<string> {
    try {
      const err = await response.json() as ApiError;
      return err.error?.message ?? err.message ?? response.statusText;
    } catch {
      return response.statusText;
    }
  }

  async registerAgent(params: {
    name: string;
    mode: AgentMode;
    desiredPortals?: string[];
    desiredConcurrency?: number;
    metadata?: AgentMetadata;
  }): Promise<AgentRegistrationResponse> {
    const response = await fetch(`${this.baseUrl}/cp/agents`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        name: params.name,
        mode: params.mode,
        desired_portals: params.desiredPortals ?? [],
        desired_concurrency: params.desiredConcurrency ?? 1,
        metadata: params.metadata ?? {},
      }),
    });

    if (!response.ok) {
      const msg = await this.parseError(response);
      throw new Error(`Failed to register agent: ${msg}`);
    }

    const result = await response.json() as ApiResponse<AgentRegistrationResponse>;
    return result.data!;
  }

  async getAgent(agentId: string): Promise<AgentRegistrationResponse | null> {
    const response = await fetch(`${this.baseUrl}/cp/agents/${agentId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      const msg = await this.parseError(response);
      throw new Error(`Failed to get agent: ${msg}`);
    }

    const result = await response.json() as ApiResponse<AgentRegistrationResponse>;
    return result.data ?? null;
  }

  async sendHeartbeat(params: {
    agentId: string;
    status: AgentStatus;
    currentJobId?: string;
    browserHealthy?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<HeartbeatResponse> {
    const response = await fetch(`${this.baseUrl}/cp/agents/${params.agentId}/heartbeat`, {
      method: 'POST',
      headers: { ...this.getHeaders(), 'x-actor-id': params.agentId },
      body: JSON.stringify({
        status: params.status,
        current_job_id: params.currentJobId,
        browser_healthy: params.browserHealthy,
        metadata: params.metadata,
      }),
    });

    if (!response.ok) {
      const msg = await this.parseError(response);
      throw new Error(`Heartbeat failed: ${msg}`);
    }

    const result = await response.json() as ApiResponse<HeartbeatResponse>;
    return result.data!;
  }

  async updateAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
    const response = await fetch(`${this.baseUrl}/cp/agents/${agentId}`, {
      method: 'PATCH',
      headers: { ...this.getHeaders(), 'x-actor-id': agentId },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      const msg = await this.parseError(response);
      throw new Error(`Failed to update agent status: ${msg}`);
    }
  }

  async getProfile(profileId: string): Promise<AgentProfileConfig | null> {
    const response = await fetch(`${this.baseUrl}/cp/profiles/${profileId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      const msg = await this.parseError(response);
      throw new Error(`Failed to get profile: ${msg}`);
    }

    const result = await response.json() as ApiResponse<{ config: AgentProfileConfig }>;
    return result.data?.config ?? null;
  }

  async getDefaultProfile(): Promise<{ id: string; config: AgentProfileConfig } | null> {
    const response = await fetch(`${this.baseUrl}/cp/profiles/default`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      const msg = await this.parseError(response);
      throw new Error(`Failed to get default profile: ${msg}`);
    }

    const result = await response.json() as ApiResponse<{ id: string; config: AgentProfileConfig }>;
    return result.data ?? null;
  }

  async getPortalConfig(portalId: string): Promise<Record<string, unknown> | null> {
    const response = await fetch(`${this.baseUrl}/cp/portals/by-portal-id/${portalId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      const msg = await this.parseError(response);
      throw new Error(`Failed to get portal config: ${msg}`);
    }

    const result = await response.json() as ApiResponse<Record<string, unknown>>;
    return result.data ?? null;
  }

  async getEnabledPortals(): Promise<Array<{ portal_id: string; name: string; config: Record<string, unknown> }>> {
    const response = await fetch(`${this.baseUrl}/cp/portals?enabled=true`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const msg = await this.parseError(response);
      throw new Error(`Failed to get portals: ${msg}`);
    }

    const result = await response.json() as ApiResponse<{ items: Array<{ portal_id: string; name: string; config: Record<string, unknown> }> }>;
    return result.data?.items ?? [];
  }

  async checkJobStatus(jobId: string): Promise<{ status: string; shouldAbort: boolean } | null> {
    try {
      const response = await fetch(`${this.publicApiUrl}/api/jobs/${jobId}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (response.status === 404) return null;
      if (!response.ok) return null;

      const result = await response.json() as ApiResponse<{ status: string }>;
      const status = result.data?.status;
      const shouldAbort = status === 'CANCELLED' || status === 'FAILED_PERMANENT';
      
      return { status: status ?? 'UNKNOWN', shouldAbort };
    } catch (err) {
      this.logger.warn({ err, jobId }, 'Failed to check job status');
      return null;
    }
  }

  /**
   * List all agents for tenant (used for restart hydration)
   */
  async listAgents(filters?: { status?: AgentStatus[] }): Promise<AgentRegistrationResponse[]> {
    let url = `${this.baseUrl}/cp/agents`;
    if (filters?.status) {
      url += `?status=${filters.status.join(',')}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const msg = await this.parseError(response);
      throw new Error(`Failed to list agents: ${msg}`);
    }

    const result = await response.json() as ApiResponse<{ items: AgentRegistrationResponse[] }>;
    return result.data?.items ?? [];
  }

  /**
   * Get job details from public API (for sync agent job fetching)
   */
  async getJob(jobId: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${this.publicApiUrl}/api/jobs/${jobId}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (response.status === 404) return null;
      if (!response.ok) return null;

      const result = await response.json() as ApiResponse<Record<string, unknown>>;
      return result.data ?? null;
    } catch (err) {
      this.logger.warn({ err, jobId }, 'Failed to get job');
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/cp/health/live`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }
}
