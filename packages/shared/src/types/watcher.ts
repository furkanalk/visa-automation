import type { DiffSeverity, PortalSnapshot } from './portal.js';

/**
 * Watcher Config - site drift detection configuration per tenant
 */
export interface WatcherConfig {
  id: string;
  tenant_id: string;
  enabled: boolean;
  window_start_hour: number;
  window_end_hour: number;
  jitter_minutes: number;
  portals: string[];
  notify_on_change: boolean;
  last_run_at?: Date;
  next_scheduled_at?: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Request/Response types for Watcher API
 */
export interface UpdateWatcherConfigRequest {
  enabled?: boolean;
  window_start_hour?: number;
  window_end_hour?: number;
  jitter_minutes?: number;
  portals?: string[];
  notify_on_change?: boolean;
}

export interface WatcherRunNowRequest {
  portal_ids?: string[];
  force?: boolean;
}

export interface WatcherRunNowResponse {
  triggered: boolean;
  portals: string[];
  message: string;
  estimated_completion?: Date;
}

export interface WatcherStatusResponse {
  config: WatcherConfig;
  status: 'idle' | 'running' | 'disabled';
  current_portal?: string;
  last_results?: WatcherRunResult[];
}

export interface WatcherRunResult {
  portal_id: string;
  snapshot_id: string;
  captured_at: Date;
  diff_severity: DiffSeverity;
  diff_summary?: string;
  changed: boolean;
}

/**
 * Snapshot comparison result
 */
export interface SnapshotCompareResult {
  current: PortalSnapshot;
  previous?: PortalSnapshot;
  changed: boolean;
  severity: DiffSeverity;
  diff_summary: string;
  details?: {
    html_changed: boolean;
    selectors_broken: string[];
    new_elements: string[];
    removed_elements: string[];
  };
}
