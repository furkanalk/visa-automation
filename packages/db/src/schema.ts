import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';
import type {
  HitlTaskType,
  HitlTaskStatus,
  HitlContext,
  HitlResolution,
  AgentMode,
  AgentStatus,
  AgentMetadata,
  AgentProfileConfig,
  PortalSettings,
  PortalSelectors,
  DOMDigest,
  SnapshotMetadata,
  DiffSeverity,
  AuditChanges,
  AuditMetadata,
  ActorType,
} from '@visa-automation/shared';

/**
 * Database schema for Kysely
 */
export interface Database {
  tenants: TenantsTable;
  jobs: JobsTable;
  job_runs: JobRunsTable;
  hitl_tasks: HitlTasksTable;
  job_screenshots: JobScreenshotsTable;
  evidence_packs: EvidencePacksTable;
  job_events: JobEventsTable;
  job_status_summary: JobStatusSummaryTable;
  // Control Plane tables
  agents: AgentsTable;
  agent_profiles: AgentProfilesTable;
  portal_configs: PortalConfigsTable;
  notify_settings: NotifySettingsTable;
  notify_dedupe: NotifyDedupeTable;
  watcher_config: WatcherConfigTable;
  watcher_run_history: WatcherRunHistoryTable;
  portal_snapshots: PortalSnapshotsTable;
  audit_logs: AuditLogsTable;
  system_settings: SystemSettingsTable;
  customers: CustomersTable;
  customer_secrets: CustomerSecretsTable;
  // Staff Management tables
  staff_members: StaffMembersTable;
  staff_activity_log: StaffActivityLogTable;
  staff_sessions: StaffSessionsTable;
  dashboard_snapshots: DashboardSnapshotsTable;
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
  agent_id: string | null;
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
  type: HitlTaskType | null;
  status: HitlTaskStatus | null;
  context: HitlContext | null;
  resolution: HitlResolution | null;
  expires_at: Date;
  created_at: ColumnType<Date, Date | undefined, never>;
  resolved_at: Date | null;
  resolved_by: string | null;
  /** FK to staff_members – who was assigned (staff portal HITL). Filled when staff portal is implemented. */
  assigned_staff_id: string | null;
  /** FK to staff_members – who resolved (staff portal HITL). Filled when staff portal is implemented. */
  resolved_staff_id: string | null;
  escalation_reason: string | null;
  escalated_at: Date | null;
  escalated_by: string | null;
}

export type HitlTask = Selectable<HitlTasksTable>;
export type NewHitlTask = Insertable<HitlTasksTable>;
export type HitlTaskUpdate = Updateable<HitlTasksTable>;

// ============================================
// Job Screenshots (HITL)
// ============================================
export interface JobScreenshotsTable {
  id: Generated<string>;
  job_id: string;
  filename: string;
  content_type: string;
  data: Buffer;
  created_at: ColumnType<Date, Date | undefined, never>;
}

export type JobScreenshotRow = Selectable<JobScreenshotsTable>;
export type NewJobScreenshot = Insertable<JobScreenshotsTable>;

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
  job_run_id: string | null;
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

// ============================================
// Agents (Control Plane)
// ============================================
export interface AgentsTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  mode: AgentMode;
  status: AgentStatus;
  profile_id: string | null;
  desired_portals: ColumnType<string[], string[], string[]>;
  desired_concurrency: ColumnType<number, number | undefined, number>;
  current_job_id: string | null;
  last_heartbeat_at: Date | null;
  metadata: ColumnType<AgentMetadata, AgentMetadata | undefined, AgentMetadata>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type Agent = Selectable<AgentsTable>;
export type NewAgent = Insertable<AgentsTable>;
export type AgentUpdate = Updateable<AgentsTable>;

// ============================================
// Agent Profiles (Control Plane)
// ============================================
export interface AgentProfilesTable {
  id: Generated<string>;
  tenant_id: string;
  name: string;
  description: string | null;
  config: ColumnType<AgentProfileConfig, AgentProfileConfig, AgentProfileConfig>;
  is_default: ColumnType<boolean, boolean | undefined, boolean>;
  is_scout: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type AgentProfile = Selectable<AgentProfilesTable>;
export type NewAgentProfile = Insertable<AgentProfilesTable>;
export type AgentProfileUpdate = Updateable<AgentProfilesTable>;

// ============================================
// Portal Configs (Control Plane)
// ============================================
export interface PortalConfigsTable {
  id: Generated<string>;
  tenant_id: string;
  portal_id: string;
  name: string;
  base_url: string | null;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  config: ColumnType<PortalSettings, PortalSettings | undefined, PortalSettings>;
  selectors: ColumnType<PortalSelectors, PortalSelectors | undefined, PortalSelectors>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type PortalConfigRow = Selectable<PortalConfigsTable>;
export type NewPortalConfig = Insertable<PortalConfigsTable>;
export type PortalConfigUpdate = Updateable<PortalConfigsTable>;

// ============================================
// Notify Settings (Control Plane)
// ============================================
export interface NotifySettingsTable {
  id: Generated<string>;
  tenant_id: string;
  telegram_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  telegram_bot_token: string | null;
  telegram_chat_ids: ColumnType<string[], string[] | undefined, string[]>;
  email_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  smtp_host: string | null;
  smtp_port: ColumnType<number, number | undefined, number>;
  smtp_user: string | null;
  smtp_pass: string | null;
  smtp_from: string | null;
  smtp_secure: ColumnType<boolean, boolean | undefined, boolean>;
  fallback_email: string | null;
  email_override: string | null;
  webhook_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  webhook_url: string | null;
  webhook_secret: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type NotifySettingsRow = Selectable<NotifySettingsTable>;
export type NewNotifySettings = Insertable<NotifySettingsTable>;
export type NotifySettingsUpdate = Updateable<NotifySettingsTable>;

// ============================================
// Notify Dedupe (one send per job_id + type + semantic_key)
// ============================================
export interface NotifyDedupeTable {
  id: Generated<string>;
  job_id: string;
  type: string;
  semantic_key: string;
  sent_at: ColumnType<Date, Date | undefined, never>;
}

export type NotifyDedupeRow = Selectable<NotifyDedupeTable>;
export type NewNotifyDedupe = Insertable<NotifyDedupeTable>;

// ============================================
// Watcher Config (Control Plane)
// ============================================
export interface WatcherConfigTable {
  id: Generated<string>;
  tenant_id: string;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  time_window_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  window_start_hour: ColumnType<number, number | undefined, number>;
  window_end_hour: ColumnType<number, number | undefined, number>;
  jitter_minutes: ColumnType<number, number | undefined, number>;
  portals: ColumnType<string[], string[] | undefined, string[]>;
  notify_on_change: ColumnType<boolean, boolean | undefined, boolean>;
  diff_mode: ColumnType<'hash' | 'selector', 'hash' | 'selector' | undefined, 'hash' | 'selector'>;
  run_retention_days: ColumnType<number, number | undefined, number>;
  snapshot_retention_days: ColumnType<number, number | undefined, number>;
  html_diff_interval: ColumnType<string, string | undefined, string>;
  last_html_diff_at: Date | null;
  last_run_at: Date | null;
  next_scheduled_at: Date | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type WatcherConfigRow = Selectable<WatcherConfigTable>;
export type NewWatcherConfig = Insertable<WatcherConfigTable>;
export type WatcherConfigUpdate = Updateable<WatcherConfigTable>;

// ============================================
// Watcher Run History (7-day retention)
// ============================================
export interface WatcherRunHistoryTable {
  id: Generated<string>;
  tenant_id: string;
  run_at: ColumnType<Date, Date | undefined, never>;
  portals_checked: ColumnType<string[], string[] | undefined, string[]>;
  jobs_created: ColumnType<number, number | undefined, number>;
  up_portal_ids: ColumnType<string[], string[] | undefined, string[]>;
  down_portal_ids: ColumnType<string[], string[] | undefined, string[]>;
  up_portals_with_no_customers: ColumnType<string[], string[] | undefined, string[]>;
  message: string | null;
}

export type WatcherRunHistoryRow = Selectable<WatcherRunHistoryTable>;
export type NewWatcherRunHistory = Insertable<WatcherRunHistoryTable>;

// ============================================
// Portal Snapshots (Control Plane)
// ============================================
export interface PortalSnapshotsTable {
  id: Generated<string>;
  tenant_id: string;
  portal_id: string;
  captured_at: ColumnType<Date, Date | undefined, never>;
  html_hash: string;
  html: string;
  dom_digest: ColumnType<DOMDigest | null, DOMDigest | null, DOMDigest | null>;
  screenshot_path: string | null;
  diff_summary: string | null;
  diff_severity: DiffSeverity | null;
  previous_snapshot_id: string | null;
  metadata: ColumnType<SnapshotMetadata, SnapshotMetadata | undefined, SnapshotMetadata>;
  archived: ColumnType<boolean, boolean | undefined, boolean>;
  archived_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  archive_summary: ColumnType<string | null, string | null | undefined, string | null>;
}

export type PortalSnapshotRow = Selectable<PortalSnapshotsTable>;
export type NewPortalSnapshot = Insertable<PortalSnapshotsTable>;
export type PortalSnapshotUpdate = Updateable<PortalSnapshotsTable>;

// ============================================
// Audit Logs (Control Plane)
// ============================================
export interface AuditLogsTable {
  id: Generated<string>;
  tenant_id: string | null;
  actor_type: ActorType;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  changes: ColumnType<AuditChanges | null, AuditChanges | null, never>;
  metadata: ColumnType<AuditMetadata, AuditMetadata | undefined, never>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
}

export type AuditLogRow = Selectable<AuditLogsTable>;
export type NewAuditLog = Insertable<AuditLogsTable>;

// ============================================
// System Settings (Centralized Config)
// ============================================
export type SettingValueType = 'string' | 'number' | 'boolean' | 'json' | 'array';

export interface SystemSettingsTable {
  id: Generated<string>;
  tenant_id: string | null;
  category: string;
  key: string;
  value: ColumnType<unknown, unknown, unknown>;
  description: string | null;
  value_type: SettingValueType;
  is_sensitive: ColumnType<boolean, boolean | undefined, boolean>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  updated_by: string | null;
}

export type SystemSetting = Selectable<SystemSettingsTable>;
export type NewSystemSetting = Insertable<SystemSettingsTable>;
export type SystemSettingUpdate = Updateable<SystemSettingsTable>;

// ============================================
// Customers
// ============================================
export type CustomerStatus = 'active' | 'paused' | 'completed' | 'cancelled';

export interface CustomerPreferences {
  visa_type?: string;
  appointment_city?: string;
  preferred_dates?: { from: string; to: string };
  family_size?: number;
  special_requirements?: string[];
}

export interface CustomerFlags {
  has_previous_refusal?: boolean;
  requires_otp_staff?: boolean;
  needs_family_booking?: boolean;
  has_travel_soon?: boolean;
  vip?: boolean;
}

export interface SlotCheckPolicy {
  active_hours?: { start: number; end: number };
  jitter_minutes?: number;
  max_checks_per_day?: number;
  cooldown_after_found_hours?: number;
  check_interval_minutes?: number;
}

export interface CustomersTable {
  id: Generated<string>;
  tenant_id: string;
  display_name: string;
  internal_ref: string | null;
  tags: ColumnType<string[], string[] | undefined, string[]>;
  portal_id: string;
  profile_id: string | null;
  status: CustomerStatus;
  priority: ColumnType<number, number | undefined, number>;
  notify_email: string | null;
  notify_phone: string | null;
  notify_telegram_chat_id: string | null;
  preferences: ColumnType<CustomerPreferences, CustomerPreferences | undefined, CustomerPreferences>;
  flags: ColumnType<CustomerFlags, CustomerFlags | undefined, CustomerFlags>;
  slot_check_policy: ColumnType<SlotCheckPolicy, SlotCheckPolicy | undefined, SlotCheckPolicy>;
  total_jobs: ColumnType<number, number | undefined, number>;
  successful_bookings: ColumnType<number, number | undefined, number>;
  last_job_at: Date | null;
  last_slot_found_at: Date | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  created_by: string | null;
  updated_by: string | null;
}

export type Customer = Selectable<CustomersTable>;
export type NewCustomer = Insertable<CustomersTable>;
export type CustomerUpdate = Updateable<CustomersTable>;

// ============================================
// Customer Secrets
// ============================================
export interface CustomerSecretsTable {
  id: Generated<string>;
  customer_id: string;
  passport_no: string | null;
  id_no: string | null;
  birth_date: Date | null;
  full_name: string | null;
  nationality: string | null;
  portal_username: string | null;
  portal_password: string | null;
  extra_fields: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type CustomerSecret = Selectable<CustomerSecretsTable>;
export type NewCustomerSecret = Insertable<CustomerSecretsTable>;
export type CustomerSecretUpdate = Updateable<CustomerSecretsTable>;

// ============================================
// Staff Members
// ============================================
export type StaffRole = 'staff' | 'admin' | 'super_admin';
export type StaffStatus = 'active' | 'inactive' | 'suspended' | 'pending';

export interface StaffSettings {
  max_concurrent_tasks?: number;
  notification_sound?: boolean;
  preferred_task_types?: string[];
}

export interface StaffMetrics {
  total_tasks?: number;
  resolved_tasks?: number;
  expired_tasks?: number;
  avg_resolution_time_ms?: number;
  success_rate?: number;
}

export interface StaffMembersTable {
  id: Generated<string>;
  tenant_id: string;
  email: string;
  password_hash: string | null;
  name: string;
  role: StaffRole;
  avatar_url: string | null;
  status: StaffStatus;
  invite_token: string | null;
  invite_token_expires_at: Date | null;
  permissions: ColumnType<string[], string[] | undefined, string[]>;
  settings: ColumnType<StaffSettings, StaffSettings | undefined, StaffSettings>;
  metrics: ColumnType<StaffMetrics, StaffMetrics | undefined, StaffMetrics>;
  last_active_at: Date | null;
  created_at: ColumnType<Date, Date | undefined, never>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type StaffMember = Selectable<StaffMembersTable>;
export type NewStaffMember = Insertable<StaffMembersTable>;
export type StaffMemberUpdate = Updateable<StaffMembersTable>;

// ============================================
// Staff Activity Log
// ============================================
export type StaffActivityAction = 
  | 'login' | 'logout' 
  | 'task_assigned' | 'task_resolved' | 'task_escalated' | 'task_expired'
  | 'customer_viewed'
  | 'session_start' | 'session_end';

export interface StaffActivityDetails {
  task_type?: string;
  resolution_time_ms?: number;
  resolution_value?: string;
  escalation_reason?: string;
  [key: string]: unknown;
}

export interface StaffActivityLogTable {
  id: Generated<string>;
  tenant_id: string;
  staff_id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: ColumnType<StaffActivityDetails, StaffActivityDetails | undefined, StaffActivityDetails>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: ColumnType<Date, Date | undefined, never>;
}

export type StaffActivityLog = Selectable<StaffActivityLogTable>;
export type NewStaffActivityLog = Insertable<StaffActivityLogTable>;

// ============================================
// Staff Sessions
// ============================================
export type SessionStatus = 'active' | 'idle' | 'busy' | 'offline';

export interface DeviceInfo {
  browser?: string;
  os?: string;
  device_type?: 'desktop' | 'mobile' | 'tablet';
}

export interface StaffSessionsTable {
  id: Generated<string>;
  tenant_id: string;
  staff_id: string;
  token_hash: string;
  status: SessionStatus;
  device_info: ColumnType<DeviceInfo, DeviceInfo | undefined, DeviceInfo>;
  last_heartbeat_at: ColumnType<Date, Date | undefined, Date>;
  created_at: ColumnType<Date, Date | undefined, never>;
  expires_at: Date;
}

export type StaffSession = Selectable<StaffSessionsTable>;
export type NewStaffSession = Insertable<StaffSessionsTable>;
export type StaffSessionUpdate = Updateable<StaffSessionsTable>;

// ============================================
// Dashboard Snapshots (Admin graph history)
// ============================================
export interface DashboardSnapshotsTable {
  id: Generated<string>;
  recorded_at: ColumnType<Date, Date | undefined, never>;
  online_agents: number;
  total_agents: number;
  active_jobs: number;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  cancelled_jobs: number;
  portal_up_count: number;
  portal_down_count: number;
}

export type DashboardSnapshot = Selectable<DashboardSnapshotsTable>;
export type NewDashboardSnapshot = Insertable<DashboardSnapshotsTable>;
