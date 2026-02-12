// Runtime URL getters that support localStorage override from Settings page
const getCpApiUrl = () =>
  (typeof window !== "undefined" && localStorage.getItem("cp_api_url")) ||
  process.env.NEXT_PUBLIC_CP_API_URL ||
  "http://localhost:3001";

const getPublicApiUrl = () =>
  (typeof window !== "undefined" && localStorage.getItem("public_api_url")) ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3000";

// Get tenant from localStorage (set by auth store) or default
const getTenantId = () =>
  (typeof window !== "undefined" && localStorage.getItem("admin_tenant_id")) ||
  "default";

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// Timeout wrapper for fetch
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 5000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchApi<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-tenant-id": getTenantId(),
    ...(options.headers as Record<string, string>),
  };

  try {
    const response = await fetchWithTimeout(url, {
      ...options,
      headers,
    }, 5000); // 5 second timeout

    const data = (await response.json()) as ApiResponse<T>;

    if (!response.ok || !data.success) {
      throw new Error(data.error?.message || "API request failed");
    }

    return data.data as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout - API server may be unavailable');
    }
    throw error;
  }
}

// CP API endpoints
export const cpApi = {
  // Agents
  getAgents: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return fetchApi<{ items: Agent[]; total: number }>(`${getCpApiUrl()}/cp/agents${query}`);
  },
  getAgent: (id: string) => fetchApi<Agent>(`${getCpApiUrl()}/cp/agents/${id}`),
  createAgent: (data: CreateAgentData) =>
    fetchApi<Agent>(`${getCpApiUrl()}/cp/agents`, { method: "POST", body: JSON.stringify(data) }),
  updateAgent: (id: string, data: Partial<Agent>) =>
    fetchApi<Agent>(`${getCpApiUrl()}/cp/agents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteAgent: (id: string) =>
    fetchApi<{ deleted: boolean }>(`${getCpApiUrl()}/cp/agents/${id}`, { method: "DELETE" }),
  scaleAgents: (data: { async_count: number; sync_count: number }) =>
    fetchApi<ScaleResponse>(`${getCpApiUrl()}/cp/agents/scale`, { method: "PATCH", body: JSON.stringify(data) }),

  // Profiles
  getProfiles: () => fetchApi<{ items: Profile[]; total: number }>(`${getCpApiUrl()}/cp/profiles`),
  getProfile: (id: string) => fetchApi<Profile>(`${getCpApiUrl()}/cp/profiles/${id}`),
  createProfile: (data: CreateProfileData) =>
    fetchApi<Profile>(`${getCpApiUrl()}/cp/profiles`, { method: "POST", body: JSON.stringify(data) }),
  updateProfile: (id: string, data: Partial<Profile>) =>
    fetchApi<Profile>(`${getCpApiUrl()}/cp/profiles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProfile: (id: string) =>
    fetchApi<{ deleted: boolean }>(`${getCpApiUrl()}/cp/profiles/${id}`, { method: "DELETE" }),

  // Portals
  getPortals: () => fetchApi<{ items: PortalConfig[]; total: number }>(`${getCpApiUrl()}/cp/portals`),
  getPortal: (id: string) => fetchApi<PortalConfig>(`${getCpApiUrl()}/cp/portals/${id}`),
  updatePortal: (id: string, data: Partial<PortalConfig>) =>
    fetchApi<PortalConfig>(`${getCpApiUrl()}/cp/portals/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // System
  getSystemStatus: () => fetchApi<SystemStatus>(`${getCpApiUrl()}/cp/system/status`),
  getHealth: () => fetchApi<HealthStatus>(`${getCpApiUrl()}/cp/health`),

  // Audit
  getAuditLogs: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return fetchApi<{ items: AuditLog[]; total: number }>(`${getCpApiUrl()}/cp/audit${query}`);
  },

  // Jobs (via CP API)
  getJobs: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return fetchApi<{ items: Job[]; total: number }>(`${getCpApiUrl()}/cp/jobs${query}`);
  },
  getJob: (id: string) => fetchApi<Job>(`${getCpApiUrl()}/cp/jobs/${id}`),
  stopJob: (id: string, reason?: string) =>
    fetchApi<{ job: Job; message: string }>(`${getCpApiUrl()}/cp/jobs/${id}/stop`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  retryJob: (id: string) =>
    fetchApi<{ job: Job; message: string }>(`${getCpApiUrl()}/cp/jobs/${id}/retry`, {
      method: "POST",
    }),
  requeueJob: (id: string) =>
    fetchApi<{ job: Job; message: string }>(`${getCpApiUrl()}/cp/jobs/${id}/requeue`, {
      method: "POST",
    }),
  getJobEvents: (id: string, limit?: number) => {
    const query = limit ? `?limit=${limit}` : "";
    return fetchApi<{ items: JobEvent[]; total: number }>(`${getCpApiUrl()}/cp/jobs/${id}/events${query}`);
  },
  getJobRuns: (id: string) =>
    fetchApi<{ items: JobEvent[]; total: number; retry_count: number }>(`${getCpApiUrl()}/cp/jobs/${id}/runs`),

  // HITL
  getHitlTasks: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return fetchApi<{ items: HitlTask[]; total: number }>(`${getCpApiUrl()}/cp/hitl${query}`);
  },
  getHitlTask: (id: string) =>
    fetchApi<{ task: HitlTask; job: Job | null }>(`${getCpApiUrl()}/cp/hitl/${id}`),
  getHitlPendingCount: () =>
    fetchApi<{ count: number }>(`${getCpApiUrl()}/cp/hitl/pending-count`),
  assignHitlTask: (id: string, assignedTo: string) =>
    fetchApi<{ task: HitlTask; message: string }>(`${getCpApiUrl()}/cp/hitl/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ assigned_to: assignedTo }),
    }),
  resolveHitlTask: (id: string, resolution: HitlResolution) =>
    fetchApi<{ task: HitlTask; message: string }>(`${getCpApiUrl()}/cp/hitl/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution }),
    }),
  cancelHitlTask: (id: string) =>
    fetchApi<{ task: HitlTask; message: string }>(`${getCpApiUrl()}/cp/hitl/${id}/cancel`, {
      method: "POST",
    }),
  getHitlTasksByJob: (jobId: string) =>
    fetchApi<{ items: HitlTask[]; total: number }>(`${getCpApiUrl()}/cp/hitl/job/${jobId}`),

  // Notification Settings
  getNotifySettings: () => fetchApi<NotifySettings>(`${getCpApiUrl()}/cp/notify`),
  updateNotifySettings: (data: UpdateNotifySettingsRequest) =>
    fetchApi<NotifySettings>(`${getCpApiUrl()}/cp/notify`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  testTelegram: (chatId?: string, message?: string) =>
    fetchApi<{ channel: string; message: string; details: Record<string, unknown> }>(
      `${getCpApiUrl()}/cp/notify/test/telegram`,
      { method: "POST", body: JSON.stringify({ chat_id: chatId, message }) }
    ),
  testEmail: (to?: string, subject?: string, body?: string) =>
    fetchApi<{ channel: string; message: string; details: Record<string, unknown> }>(
      `${getCpApiUrl()}/cp/notify/test/email`,
      { method: "POST", body: JSON.stringify({ to, subject, body }) }
    ),

  // Watcher
  getWatcherConfig: () =>
    fetchApi<{ config: WatcherConfig; status: string }>(`${getCpApiUrl()}/cp/watcher`),
  updateWatcherConfig: (data: UpdateWatcherConfigRequest) =>
    fetchApi<WatcherConfig>(`${getCpApiUrl()}/cp/watcher`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  runWatcher: (portalIds?: string[], force?: boolean) =>
    fetchApi<WatcherRunResult>(`${getCpApiUrl()}/cp/watcher/run-now`, {
      method: "POST",
      body: JSON.stringify({ portal_ids: portalIds, force }),
    }),
  getWatcherStatus: () =>
    fetchApi<WatcherStatus>(`${getCpApiUrl()}/cp/watcher/status`),
  getSnapshots: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return fetchApi<{ items: WatcherSnapshot[]; total: number }>(`${getCpApiUrl()}/cp/watcher/snapshots${query}`);
  },
  getSnapshot: (id: string) =>
    fetchApi<WatcherSnapshotFull>(`${getCpApiUrl()}/cp/watcher/snapshots/${id}`),
  getSnapshotHtml: (id: string) =>
    fetch(`${getCpApiUrl()}/cp/watcher/snapshots/${id}/html`, {
      headers: { "x-tenant-id": getTenantId() },
    }).then((r) => r.text()),
  getLatestDiff: (portalId: string) =>
    fetchApi<WatcherDiff>(`${getCpApiUrl()}/cp/watcher/diffs/latest?portal_id=${portalId}`),
};

// Public API endpoints (for job submission)
export const api = {
  submitJob: (data: CreateJobData) =>
    fetchApi<Job>(`${getPublicApiUrl()}/api/jobs`, { method: "POST", body: JSON.stringify(data) }),
  getJobStatus: (id: string) => fetchApi<Job>(`${getPublicApiUrl()}/api/jobs/${id}`),
};

// Types
export interface Agent {
  id: string;
  tenant_id: string;
  name: string;
  mode: "ASYNC" | "SYNC";
  status: "ONLINE" | "OFFLINE" | "DISABLED" | "DRAINING";
  profile_id: string | null;
  desired_portals: string[];
  desired_concurrency: number;
  current_job_id: string | null;
  last_heartbeat_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentData {
  name: string;
  mode?: "ASYNC" | "SYNC";
  profile_id?: string;
  desired_portals?: string[];
  desired_concurrency?: number;
}

export interface Profile {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateProfileData {
  name: string;
  description?: string;
  config: Record<string, unknown>;
  is_default?: boolean;
}

export interface PortalConfig {
  id: string;
  tenant_id: string;
  portal_id: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  tenant_id: string;
  external_ref: string | null;
  visa_type: string;
  status: string;
  priority: number;
  applicant_data: Record<string, unknown>;
  config: Record<string, unknown>;
  retry_count: number;
  max_retries: number;
  locked_by: string | null;
  locked_until: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobEvent {
  id: string;
  job_id: string;
  tenant_id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface CreateJobData {
  visa_type: string;
  applicant_data: Record<string, unknown>;
  config?: Record<string, unknown>;
  priority?: number;
}

export interface SystemStatus {
  version: string;
  uptime_seconds: number;
  tenant_count: number;
  job_stats: { total: number; active: number; completed: number };
  agent_stats: { total: number; online: number; offline: number };
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  checks: Record<string, { status: string; latency_ms?: number }>;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  actor_id: string;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type HitlTaskType =
  | "TURNSTILE"
  | "CAPTCHA"
  | "OTP"
  | "DOCUMENT_CLARIFICATION"
  | "MANUAL_REVIEW"
  | "CUSTOM_INPUT";

export type HitlTaskStatus =
  | "PENDING"
  | "ASSIGNED"
  | "RESOLVED"
  | "EXPIRED"
  | "CANCELLED";

export interface HitlContext {
  screenshot_url?: string;
  html_snapshot_url?: string;
  prompt: string;
  input_type: "text" | "select" | "file" | "checkbox";
  options?: string[];
  metadata?: Record<string, unknown>;
}

export interface HitlResolution {
  value: string;
  confidence?: number;
  notes?: string;
}

export interface HitlTask {
  id: string;
  job_id: string;
  job_run_id: string;
  tenant_id: string;
  type: HitlTaskType | null;
  status: HitlTaskStatus | null;
  context: HitlContext | null;
  resolution: HitlResolution | null;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface ScaleResponse {
  current_async: number;
  current_sync: number;
  target_async: number;
  target_sync: number;
  scaling_in_progress: boolean;
}

export interface NotifySettings {
  id: string;
  tenant_id: string;
  telegram_enabled: boolean;
  telegram_bot_token: string | null;
  telegram_chat_ids: string[] | null;
  email_enabled: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_pass: string | null;
  smtp_from: string | null;
  smtp_secure: boolean;
  fallback_email: string | null;
  email_override: string | null;
  webhook_enabled: boolean;
  webhook_url: string | null;
  webhook_secret: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateNotifySettingsRequest {
  telegram_enabled?: boolean;
  telegram_bot_token?: string | null;
  telegram_chat_ids?: string[];
  email_enabled?: boolean;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_user?: string | null;
  smtp_pass?: string | null;
  smtp_from?: string | null;
  smtp_secure?: boolean;
  fallback_email?: string | null;
  email_override?: string | null;
  webhook_enabled?: boolean;
  webhook_url?: string | null;
  webhook_secret?: string | null;
}

// Watcher types
export interface WatcherConfig {
  id: string;
  tenant_id: string;
  enabled: boolean;
  window_start_hour: number;
  window_end_hour: number;
  jitter_minutes: number;
  portals: string[] | null;
  notify_on_change: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateWatcherConfigRequest {
  enabled?: boolean;
  window_start_hour?: number;
  window_end_hour?: number;
  jitter_minutes?: number;
  portals?: string[];
  notify_on_change?: boolean;
}

export interface WatcherRunResult {
  triggered: boolean;
  portals: string[];
  message: string;
  estimated_completion: string;
}

export interface WatcherSnapshot {
  id: string;
  portal_id: string;
  captured_at: string;
  html_hash: string;
  diff_severity: "none" | "minor" | "major" | "critical" | null;
  diff_summary: string | null;
  has_screenshot: boolean;
  metadata: Record<string, unknown> | null;
}

export interface WatcherSnapshotFull extends WatcherSnapshot {
  tenant_id: string;
  html: string;
  screenshot_path: string | null;
  previous_snapshot_id: string | null;
}

export interface WatcherStatus {
  config: WatcherConfig | null;
  status: "not_configured" | "enabled" | "disabled";
  last_results: Array<{
    portal_id: string;
    snapshot_id: string;
    captured_at: string;
    diff_severity: string;
    diff_summary: string | null;
    changed: boolean;
  }>;
}

export interface WatcherDiff {
  current: {
    id: string;
    captured_at: string;
    html_hash: string;
    diff_severity: string | null;
    diff_summary: string | null;
  };
  previous: {
    id: string;
    captured_at: string;
    html_hash: string;
  } | null;
  changed: boolean;
}

// ============================================
// System Settings Types
// ============================================

export interface SystemSetting {
  id: string;
  tenant_id: string | null;
  category: string;
  key: string;
  value: unknown;
  description: string | null;
  value_type: 'string' | 'number' | 'boolean' | 'json' | 'array';
  is_sensitive: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
  isGlobal?: boolean;
}

export interface SettingsGrouped {
  [category: string]: {
    [key: string]: unknown;
  };
}

// ============================================
// Customer Types
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

export interface Customer {
  id: string;
  tenant_id: string;
  display_name: string;
  internal_ref: string | null;
  tags: string[];
  portal_id: string;
  profile_id: string | null;
  status: CustomerStatus;
  priority: number;
  notify_email: string | null;
  notify_phone: string | null;
  notify_telegram_chat_id: string | null;
  preferences: CustomerPreferences;
  flags: CustomerFlags;
  slot_check_policy: SlotCheckPolicy;
  total_jobs: number;
  successful_bookings: number;
  last_job_at: string | null;
  last_slot_found_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface CustomerSecret {
  id: string;
  customer_id: string;
  passport_no: string | null;
  id_no: string | null;
  birth_date: string | null;
  full_name: string | null;
  nationality: string | null;
  portal_username: string | null;
  portal_password: string | null;
  extra_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CustomerWithSecrets extends Customer {
  secrets?: CustomerSecret | null;
}

export interface CustomerCounts {
  active: number;
  paused: number;
  completed: number;
  cancelled: number;
}

// ============================================
// Settings API
// ============================================

export const settingsApi = {
  async getAll(): Promise<SettingsGrouped> {
    return fetchApi<{ data: SettingsGrouped }>(`${getCpApiUrl()}/cp/settings`).then(r => r.data);
  },

  async getList(category?: string): Promise<{ items: SystemSetting[]; total: number }> {
    const query = category ? `?category=${category}` : '';
    return fetchApi<{ data: { items: SystemSetting[]; total: number } }>(
      `${getCpApiUrl()}/cp/settings/list${query}`
    ).then(r => r.data);
  },

  async getCategories(): Promise<string[]> {
    return fetchApi<{ data: { categories: string[] } }>(
      `${getCpApiUrl()}/cp/settings/categories`
    ).then(r => r.data.categories);
  },

  async getValue(category: string, key: string): Promise<unknown> {
    return fetchApi<{ data: { value: unknown } }>(
      `${getCpApiUrl()}/cp/settings/${category}/${key}`
    ).then(r => r.data.value);
  },

  async setValue(category: string, key: string, value: unknown, description?: string): Promise<SystemSetting> {
    return fetchApi<{ data: SystemSetting }>(
      `${getCpApiUrl()}/cp/settings/${category}/${key}`,
      {
        method: 'PUT',
        body: JSON.stringify({ value, description }),
      }
    ).then(r => r.data);
  },

  async bulkUpdate(updates: Array<{ category: string; key: string; value: unknown }>): Promise<void> {
    await fetchApi(`${getCpApiUrl()}/cp/settings/bulk`, {
      method: 'PATCH',
      body: JSON.stringify({ updates }),
    });
  },

  async deleteTenantSetting(category: string, key: string): Promise<void> {
    await fetchApi(`${getCpApiUrl()}/cp/settings/${category}/${key}`, {
      method: 'DELETE',
    });
  },

  async getGlobalSettings(): Promise<{ items: SystemSetting[]; total: number }> {
    return fetchApi<{ data: { items: SystemSetting[]; total: number } }>(
      `${getCpApiUrl()}/cp/settings/global`
    ).then(r => r.data);
  },

  async setGlobalValue(category: string, key: string, value: unknown, description?: string): Promise<SystemSetting> {
    return fetchApi<{ data: SystemSetting }>(
      `${getCpApiUrl()}/cp/settings/global/${category}/${key}`,
      {
        method: 'PUT',
        body: JSON.stringify({ value, description }),
      }
    ).then(r => r.data);
  },
};

// ============================================
// Customer API
// ============================================

export interface CustomerFilters {
  status?: string;
  portal_id?: string;
  profile_id?: string;
  tags?: string;
  search?: string;
  priority_min?: number;
  priority_max?: number;
  limit?: number;
  offset?: number;
}

export const customerApi = {
  async list(filters: CustomerFilters = {}): Promise<{ items: Customer[]; total: number; counts: CustomerCounts }> {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.portal_id) params.append('portal_id', filters.portal_id);
    if (filters.profile_id) params.append('profile_id', filters.profile_id);
    if (filters.tags) params.append('tags', filters.tags);
    if (filters.search) params.append('search', filters.search);
    if (filters.priority_min) params.append('priority_min', String(filters.priority_min));
    if (filters.priority_max) params.append('priority_max', String(filters.priority_max));
    if (filters.limit) params.append('limit', String(filters.limit));
    if (filters.offset) params.append('offset', String(filters.offset));
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchApi<{ data: { items: Customer[]; total: number; counts: CustomerCounts } }>(
      `${getCpApiUrl()}/cp/customers${query}`
    ).then(r => r.data);
  },

  async getCounts(): Promise<CustomerCounts> {
    return fetchApi<{ data: CustomerCounts }>(`${getCpApiUrl()}/cp/customers/counts`).then(r => r.data);
  },

  async getById(id: string, includeSecrets = false): Promise<CustomerWithSecrets> {
    const query = includeSecrets ? '?include_secrets=true' : '';
    return fetchApi<{ data: CustomerWithSecrets }>(`${getCpApiUrl()}/cp/customers/${id}${query}`).then(r => r.data);
  },

  async getRedacted(id: string): Promise<Partial<Customer>> {
    return fetchApi<{ data: Partial<Customer> }>(`${getCpApiUrl()}/cp/customers/${id}/redacted`).then(r => r.data);
  },

  async create(customer: Omit<Customer, 'id' | 'tenant_id' | 'total_jobs' | 'successful_bookings' | 'last_job_at' | 'last_slot_found_at' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'>): Promise<Customer> {
    return fetchApi<{ data: Customer }>(`${getCpApiUrl()}/cp/customers`, {
      method: 'POST',
      body: JSON.stringify(customer),
    }).then(r => r.data);
  },

  async update(id: string, updates: Partial<Customer>): Promise<Customer> {
    return fetchApi<{ data: Customer }>(`${getCpApiUrl()}/cp/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }).then(r => r.data);
  },

  async delete(id: string, hard = false): Promise<void> {
    const query = hard ? '?hard=true' : '';
    await fetchApi(`${getCpApiUrl()}/cp/customers/${id}${query}`, {
      method: 'DELETE',
    });
  },

  async pause(id: string): Promise<Customer> {
    return fetchApi<{ data: Customer }>(`${getCpApiUrl()}/cp/customers/${id}/pause`, {
      method: 'POST',
    }).then(r => r.data);
  },

  async resume(id: string): Promise<Customer> {
    return fetchApi<{ data: Customer }>(`${getCpApiUrl()}/cp/customers/${id}/resume`, {
      method: 'POST',
    }).then(r => r.data);
  },

  async getSecrets(id: string): Promise<CustomerSecret | null> {
    return fetchApi<{ data: CustomerSecret | null }>(`${getCpApiUrl()}/cp/customers/${id}/secrets`).then(r => r.data);
  },

  async updateSecrets(id: string, secrets: Partial<CustomerSecret>): Promise<CustomerSecret> {
    return fetchApi<{ data: CustomerSecret }>(`${getCpApiUrl()}/cp/customers/${id}/secrets`, {
      method: 'PUT',
      body: JSON.stringify(secrets),
    }).then(r => r.data);
  },

  async triggerSlotCheck(id: string): Promise<{ message: string; customer_id: string }> {
    return fetchApi<{ data: { message: string; customer_id: string } }>(
      `${getCpApiUrl()}/cp/customers/${id}/run-slot-check`,
      { method: 'POST' }
    ).then(r => r.data);
  },

  async bulkAction(action: 'pause' | 'resume' | 'assign_profile' | 'update_status', ids: string[], options?: { profile_id?: string; status?: CustomerStatus }): Promise<{ affected: number }> {
    return fetchApi<{ data: { affected: number } }>(`${getCpApiUrl()}/cp/customers/bulk`, {
      method: 'POST',
      body: JSON.stringify({ action, ids, ...options }),
    }).then(r => r.data);
  },
};
