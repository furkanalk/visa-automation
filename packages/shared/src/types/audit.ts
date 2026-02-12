/**
 * Audit Log - immutable audit trail for admin/CP actions
 */
export interface AuditLog {
  id: string;
  tenant_id?: string;
  actor_type: ActorType;
  actor_id?: string;
  actor_name?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  changes?: AuditChanges;
  metadata: AuditMetadata;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}

export type ActorType = 'user' | 'system' | 'api' | 'agent';

export interface AuditChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

export interface AuditMetadata {
  request_id?: string;
  duration_ms?: number;
  status_code?: number;
  error?: string;
  [key: string]: unknown;
}

/**
 * Common audit actions
 */
export type AuditAction =
  // Agent actions
  | 'agent.create'
  | 'agent.update'
  | 'agent.delete'
  | 'agent.enable'
  | 'agent.disable'
  | 'agent.assign_profile'
  | 'agent.assign_portals'
  | 'agent.scale'
  // Profile actions
  | 'profile.create'
  | 'profile.update'
  | 'profile.delete'
  | 'profile.set_default'
  // Portal actions
  | 'portal.create'
  | 'portal.update'
  | 'portal.enable'
  | 'portal.disable'
  | 'portal.assign_agents'
  // Notify actions
  | 'notify.update'
  | 'notify.test_telegram'
  | 'notify.test_email'
  // Watcher actions
  | 'watcher.update'
  | 'watcher.run_now'
  | 'watcher.snapshot_captured'
  // Job actions
  | 'job.create'
  | 'job.cancel'
  | 'job.retry'
  | 'job.pause'
  | 'job.resume'
  // HITL actions
  | 'hitl.resolve'
  | 'hitl.escalate'
  | 'hitl.timeout'
  // System actions
  | 'system.incident_mode'
  | 'system.maintenance'
  | 'auth.login'
  | 'auth.logout';

export type AuditResourceType =
  | 'agent'
  | 'profile'
  | 'portal'
  | 'notify'
  | 'watcher'
  | 'snapshot'
  | 'job'
  | 'hitl'
  | 'system';

/**
 * Request/Response types for Audit API
 */
export interface CreateAuditLogRequest {
  tenant_id?: string;
  actor_type: ActorType;
  actor_id?: string;
  actor_name?: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  changes?: AuditChanges;
  metadata?: AuditMetadata;
  ip_address?: string;
  user_agent?: string;
}

export interface ListAuditLogsQuery {
  tenant_id?: string;
  actor_type?: ActorType;
  actor_id?: string;
  action?: string | string[];
  resource_type?: string;
  resource_id?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLogSummary {
  total_count: number;
  by_action: Record<string, number>;
  by_resource_type: Record<string, number>;
  by_actor_type: Record<ActorType, number>;
}
