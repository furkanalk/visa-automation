import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * Database schema for Kysely
 */
export interface Database {
  tenants: TenantsTable;
  jobs: JobsTable;
  job_runs: JobRunsTable;
  hitl_tasks: HitlTasksTable;
  evidence_packs: EvidencePacksTable;
  job_events: JobEventsTable;
  job_status_summary: JobStatusSummaryTable;
}

// ============================================
// Tenants
// ============================================
export interface TenantsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  config: ColumnType<TenantConfig, TenantConfig, TenantConfig>;
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface TenantConfig {
  max_concurrent_jobs: number;
  default_priority: number;
  notification_channels: string[];
  webhook_url?: string;
  hitl_timeout_minutes: number;
}

export type Tenant = Selectable<TenantsTable>;
export type NewTenant = Insertable<TenantsTable>;
export type TenantUpdate = Updateable<TenantsTable>;

// ============================================
// Jobs
// ============================================
export interface JobsTable {
  id: Generated<string>;
  tenant_id: string;
  external_ref: string | null;
  visa_type: string;
  status: string;
  priority: ColumnType<number, number | undefined, number>;
  applicant_data: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  config: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  retry_count: ColumnType<number, number | undefined, number>;
  max_retries: ColumnType<number, number | undefined, number>;
  locked_by: string | null;
  locked_until: Date | null;
  completed_at: Date | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type Job = Selectable<JobsTable>;
export type NewJob = Insertable<JobsTable>;
export type JobUpdate = Updateable<JobsTable>;

// ============================================
// Job Runs
// ============================================
export interface JobRunsTable {
  id: Generated<string>;
  job_id: string;
  tenant_id: string;
  worker_id: string;
  attempt_number: number;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  started_at: ColumnType<Date, Date | undefined, never>;
  finished_at: Date | null;
  error_code: string | null;
  error_message: string | null;
  checkpoint_data: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
}

export type JobRun = Selectable<JobRunsTable>;
export type NewJobRun = Insertable<JobRunsTable>;
export type JobRunUpdate = Updateable<JobRunsTable>;

// ============================================
// HITL Tasks
// ============================================
export interface HitlTasksTable {
  id: Generated<string>;
  job_id: string;
  job_run_id: string;
  tenant_id: string;
  type: 'CAPTCHA' | 'OTP' | 'DOCUMENT_CLARIFICATION' | 'MANUAL_VERIFICATION' | 'CUSTOM_INPUT';
  status: 'PENDING' | 'ASSIGNED' | 'RESOLVED' | 'EXPIRED' | 'CANCELLED';
  context: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
  resolution: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  expires_at: Date;
  created_at: ColumnType<Date, Date | undefined, never>;
  resolved_at: Date | null;
  resolved_by: string | null;
}

export type HitlTask = Selectable<HitlTasksTable>;
export type NewHitlTask = Insertable<HitlTasksTable>;
export type HitlTaskUpdate = Updateable<HitlTasksTable>;

// ============================================
// Evidence Packs
// ============================================
export interface EvidencePacksTable {
  id: Generated<string>;
  job_id: string;
  tenant_id: string;
  storage_path: string;
  checksum: string;
  size_bytes: number;
  sealed_at: ColumnType<Date, Date | undefined, never>;
  expires_at: Date | null;
  contents: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
}

export type EvidencePack = Selectable<EvidencePacksTable>;
export type NewEvidencePack = Insertable<EvidencePacksTable>;
export type EvidencePackUpdate = Updateable<EvidencePacksTable>;

// ============================================
// Job Events (Partition-Ready)
// ============================================
export interface JobEventsTable {
  id: Generated<number>;
  job_id: string;
  tenant_id: string;
  event_type: string;
  payload: ColumnType<Record<string, unknown> | null, Record<string, unknown> | null, Record<string, unknown> | null>;
  created_at: ColumnType<Date, Date | undefined, never>;
}

export type JobEvent = Selectable<JobEventsTable>;
export type NewJobEvent = Insertable<JobEventsTable>;

// ============================================
// Job Status Summary (Portal Projection)
// ============================================
export interface JobStatusSummaryTable {
  job_id: string;
  tenant_id: string;
  current_state: string;
  status_text: string;
  priority: number;
  applicant_name: string | null;
  last_transition_at: Date;
  last_error_code: string | null;
  last_error_message: string | null;
  hitl_pending: ColumnType<boolean, boolean | undefined, boolean>;
  hitl_expires_at: Date | null;
  evidence_pack_id: string | null;
  confirmation_number: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export type JobStatusSummary = Selectable<JobStatusSummaryTable>;
export type NewJobStatusSummary = Insertable<JobStatusSummaryTable>;
export type JobStatusSummaryUpdate = Updateable<JobStatusSummaryTable>;
