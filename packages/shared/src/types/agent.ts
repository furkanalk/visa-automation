/**
 * Agent entity - represents a logical worker instance managed by the Control Plane
 */
export interface Agent {
  id: string;
  tenant_id: string;
  name: string;
  mode: AgentMode;
  status: AgentStatus;
  profile_id?: string;
  desired_portals: string[];
  desired_concurrency: number;
  current_job_id?: string;
  last_heartbeat_at?: Date;
  metadata: AgentMetadata;
  created_at: Date;
  updated_at: Date;
}

export type AgentMode = 'ASYNC' | 'SYNC';

export type AgentStatus = 'ONLINE' | 'OFFLINE' | 'DISABLED' | 'DRAINING';

export interface AgentMetadata {
  hostname?: string;
  ip_address?: string;
  version?: string;
  browser_healthy?: boolean;
  [key: string]: unknown;
}

/**
 * Agent Profile - configuration profiles for agents
 */
export interface AgentProfile {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  config: AgentProfileConfig;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface AgentProfileConfig {
  rateLimit?: {
    rpm?: number;
    rph?: number;
  };
  pacing?: {
    minMs?: number;
    maxMs?: number;
  };
  slotHunt?: {
    maxPolls?: number;
    sleepMinMs?: number;
    sleepMaxMs?: number;
  };
  timeouts?: {
    navigationMs?: number;
    actionMs?: number;
    pageLoadMs?: number;
  };
  retry?: {
    maxAttempts?: number;
    delayMs?: number;
    backoffMultiplier?: number;
  };
  [key: string]: unknown;
}

/**
 * Request/Response types for Agent API
 */
export interface CreateAgentRequest {
  name: string;
  mode?: AgentMode;
  profile_id?: string;
  desired_portals?: string[];
  desired_concurrency?: number;
  metadata?: AgentMetadata;
}

export interface UpdateAgentRequest {
  name?: string;
  mode?: AgentMode;
  status?: AgentStatus;
  profile_id?: string | null;
  desired_portals?: string[];
  desired_concurrency?: number;
  metadata?: AgentMetadata;
}

export interface AgentHeartbeatRequest {
  agent_id: string;
  status: AgentStatus;
  current_job_id?: string;
  browser_healthy?: boolean;
  metadata?: AgentMetadata;
}

export interface AgentHeartbeatResponse {
  acknowledged: boolean;
  config_changed: boolean;
  desired_status?: AgentStatus;
  profile?: AgentProfileConfig;
}

/**
 * Bulk operations
 */
export type BulkSelectorStrategy = 'ALL' | 'COUNT' | 'PERCENT' | 'FILTER';

export interface BulkAgentSelector {
  strategy: BulkSelectorStrategy;
  value?: number; // For COUNT or PERCENT
  filters?: {
    mode?: AgentMode;
    status?: AgentStatus[];
    portal_id?: string;
  };
}

export interface BulkAssignProfileRequest {
  profile_id: string;
  selector: BulkAgentSelector;
}

export interface BulkAssignProfileResponse {
  affected_count: number;
  agent_ids: string[];
}

export interface ScaleAgentsRequest {
  async_count: number;
  sync_count: number;
}

export interface ScaleAgentsResponse {
  current_async: number;
  current_sync: number;
  target_async: number;
  target_sync: number;
  scaling_in_progress: boolean;
}

/**
 * Agent Profile Request/Response types
 */
export interface CreateProfileRequest {
  name: string;
  description?: string;
  config: AgentProfileConfig;
  is_default?: boolean;
}

export interface UpdateProfileRequest {
  name?: string;
  description?: string;
  config?: AgentProfileConfig;
  is_default?: boolean;
}

/**
 * Agent list filters
 */
export interface ListAgentsQuery {
  status?: AgentStatus | AgentStatus[];
  mode?: AgentMode;
  portal_id?: string;
  profile_id?: string;
  limit?: number;
  offset?: number;
}
