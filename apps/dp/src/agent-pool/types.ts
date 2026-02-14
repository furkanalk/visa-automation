import type { AgentMode, AgentStatus, AgentProfileConfig } from '@visa-automation/shared';

/**
 * Runtime representation of an agent in the worker process
 */
export interface AgentRuntime {
  id: string;
  name: string;
  tenantId: string;
  mode: AgentMode;
  status: AgentRuntimeStatus;
  profile: AgentProfileConfig | null;
  profileId: string | null;
  assignedPortals: string[];
  desiredConcurrency: number;
  currentJobId: string | null;
  lastHeartbeatAt: Date | null;
  metadata: Record<string, unknown>;
}

/**
 * Agent runtime status (local to worker, different from DB status)
 */
export type AgentRuntimeStatus = 
  | 'IDLE'        // Ready to pick up jobs
  | 'RUNNING'     // Currently executing a job
  | 'PAUSED'      // Temporarily paused (e.g., config refresh)
  | 'DRAINING'    // Finishing current job, won't pick new ones
  | 'STOPPED';    // Not active

/**
 * Configuration for the AgentPool
 */
export interface AgentPoolConfig {
  tenantId: string;
  workerId: string;
  cpApiUrl: string;
  publicApiUrl: string;
  heartbeatIntervalMs: number;
  configRefreshIntervalMs: number;
  syncPollIntervalMs: number;
  maxAgents: number;
}

/**
 * Response from CP API for agent registration
 */
export interface AgentRegistrationResponse {
  id: string;
  name: string;
  mode: AgentMode;
  status: AgentStatus;
  profile_id: string | null;
  profile?: AgentProfileConfig;
  desired_portals: string[];
  desired_concurrency: number;
  current_job_id?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Response from CP API heartbeat
 */
export interface HeartbeatResponse {
  acknowledged: boolean;
  config_changed: boolean;
  profile?: AgentProfileConfig;
  desired_portals: string[];
  desired_concurrency: number;
}

/**
 * Events emitted by AgentPool
 */
export interface AgentPoolEvents {
  'agent:created': (agent: AgentRuntime) => void;
  'agent:started': (agent: AgentRuntime) => void;
  'agent:stopped': (agent: AgentRuntime) => void;
  'agent:job:started': (agent: AgentRuntime, jobId: string) => void;
  'agent:job:completed': (agent: AgentRuntime, jobId: string) => void;
  'agent:job:failed': (agent: AgentRuntime, jobId: string, error: Error) => void;
  'config:refreshed': () => void;
  'error': (error: Error) => void;
}

/**
 * Job assignment for sync agent
 */
export interface SyncJobRequest {
  agentId: string;
  jobId: string;
  tenantId: string;
  portalId: string;
  stepByStep?: boolean;
}

/**
 * Scale request from CP
 */
export interface ScaleRequest {
  asyncCount: number;
  syncCount: number;
}
