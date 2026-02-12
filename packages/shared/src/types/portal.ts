/**
 * Portal Config - per-portal configuration and settings
 */
export interface PortalConfig {
  id: string;
  tenant_id: string;
  portal_id: string;
  name: string;
  base_url?: string;
  enabled: boolean;
  config: PortalSettings;
  selectors: PortalSelectors;
  created_at: Date;
  updated_at: Date;
}

export interface PortalSettings {
  mode?: 'SERIAL' | 'PARALLEL';
  max_concurrency?: number;
  pacing?: {
    minMs?: number;
    maxMs?: number;
  };
  rateLimit?: {
    rpm?: number;
    rph?: number;
  };
  circuitBreaker?: {
    consecutive_403?: number;
    rate_429_pct?: number;
    window_seconds?: number;
    pause_minutes?: number;
  };
  requestBudget?: {
    rpm?: number;
    rph?: number;
    daily?: number;
  };
  [key: string]: unknown;
}

export interface PortalSelectors {
  loginForm?: {
    email?: string;
    password?: string;
    submit?: string;
  };
  dateSelector?: string;
  slotContainer?: string;
  confirmButton?: string;
  [key: string]: unknown;
}

/**
 * Portal Snapshot - HTML snapshots for drift detection
 */
export interface PortalSnapshot {
  id: string;
  tenant_id: string;
  portal_id: string;
  captured_at: Date;
  html_hash: string;
  html: string;
  dom_digest?: DOMDigest;
  screenshot_path?: string;
  diff_summary?: string;
  diff_severity?: DiffSeverity;
  previous_snapshot_id?: string;
  metadata: SnapshotMetadata;
}

export type DiffSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';

export interface DOMDigest {
  title?: string;
  formCount?: number;
  inputCount?: number;
  buttonCount?: number;
  keySelectors?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface SnapshotMetadata {
  url?: string;
  status_code?: number;
  response_time_ms?: number;
  user_agent?: string;
  [key: string]: unknown;
}

/**
 * Request/Response types for Portal API
 */
export interface CreatePortalConfigRequest {
  portal_id: string;
  name: string;
  base_url?: string;
  enabled?: boolean;
  config?: PortalSettings;
  selectors?: PortalSelectors;
}

export interface UpdatePortalConfigRequest {
  name?: string;
  base_url?: string;
  enabled?: boolean;
  config?: PortalSettings;
  selectors?: PortalSelectors;
}

export interface AssignAgentsToPortalRequest {
  agent_ids: string[];
}

export interface AssignAgentsToPortalResponse {
  portal_id: string;
  assigned_agents: string[];
  previously_assigned: string[];
}

export interface ListPortalsQuery {
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListSnapshotsQuery {
  portal_id?: string;
  from?: Date;
  to?: Date;
  severity?: DiffSeverity | DiffSeverity[];
  limit?: number;
  offset?: number;
}
