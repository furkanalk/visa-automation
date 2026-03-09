// Runtime URL getters that support localStorage override from Settings page
export const getCpApiUrl = () =>
  (typeof window !== "undefined" && localStorage.getItem("cp_api_url")) ||
  process.env.NEXT_PUBLIC_CP_API_URL ||
  "http://localhost:3001";

// Public job API (create, status, stop, ack) is served by cp at /api/jobs
const getPublicApiUrl = () =>
  (typeof window !== "undefined" && localStorage.getItem("public_api_url")) ||
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_CP_API_URL ||
  "http://localhost:3001";

// Get tenant from localStorage (set by auth store) or default
const getTenantId = () =>
  (typeof window !== "undefined" && localStorage.getItem("admin_tenant_id")) ||
  "default";

// Get role from auth store for CP system endpoints (e.g. /cp/system/status)
const getRoles = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem("visa-automation-auth");
    if (!raw) return undefined;
    const state = JSON.parse(raw) as { state?: { user?: { role?: string } } };
    return state?.state?.user?.role;
  } catch {
    return undefined;
  }
};

// Actor info for audit logs (x-actor-id, x-actor-name)
const getActorId = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem("visa-automation-auth");
    if (!raw) return undefined;
    const state = JSON.parse(raw) as { state?: { user?: { id?: string } } };
    return state?.state?.user?.id;
  } catch {
    return undefined;
  }
};

const getActorName = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem("visa-automation-auth");
    if (!raw) return undefined;
    const state = JSON.parse(raw) as { state?: { user?: { name?: string; email?: string } } };
    const user = state?.state?.user;
    return user?.name ?? user?.email;
  } catch {
    return undefined;
  }
};

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
  options: RequestInit = {},
  timeoutMs: number = 5000
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-tenant-id": getTenantId(),
    ...(options.headers as Record<string, string>),
  };
  const role = getRoles();
  if (role) headers["x-roles"] = role;
  const actorId = getActorId();
  if (actorId) headers["x-actor-id"] = actorId;
  const actorName = getActorName();
  if (actorName) headers["x-actor-name"] = actorName;

  try {
    const response = await fetchWithTimeout(url, {
      ...options,
      headers,
    }, timeoutMs);

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

/** Fetch screenshot image with auth (for HITL View Screenshot). Returns blob URL or null. */
export async function fetchScreenshotBlob(screenshotPath: string): Promise<string | null> {
  const base = getCpApiUrl().replace(/\/+$/, "");
  const path = screenshotPath.startsWith("/") ? screenshotPath : `/${screenshotPath}`;
  const url = path.startsWith("/cp/") ? `${base}${path}` : `${base}/cp${path}`;
  const headers: Record<string, string> = { "x-tenant-id": getTenantId() };
  const role = getRoles();
  if (role) headers["x-roles"] = role;
  const actorId = getActorId();
  if (actorId) headers["x-actor-id"] = actorId;
  const actorName = getActorName();
  if (actorName) headers["x-actor-name"] = actorName;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Fetches a file from CP with auth headers and returns raw text content. */
export async function fetchFileText(screenshotPath: string): Promise<string | null> {
  const base = getCpApiUrl().replace(/\/+$/, "");
  const path = screenshotPath.startsWith("/") ? screenshotPath : `/${screenshotPath}`;
  const url = path.startsWith("/cp/") ? `${base}${path}` : `${base}/cp${path}`;
  const headers: Record<string, string> = { "x-tenant-id": getTenantId() };
  const role = getRoles();
  if (role) headers["x-roles"] = role;
  const actorId = getActorId();
  if (actorId) headers["x-actor-id"] = actorId;
  const actorName = getActorName();
  if (actorName) headers["x-actor-name"] = actorName;
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  return res.text();
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
  forceStopAgent: (id: string) =>
    fetchApi<Agent>(`${getCpApiUrl()}/cp/agents/${id}/force-stop`, { method: "POST", body: "{}" }),
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
  getPortalLiveness: () =>
    fetchApi<{ items: { portal_id: string; name: string; status: "up" | "down"; checked_at: string }[]; checked_at: string }>(
      `${getCpApiUrl()}/cp/portals/liveness`
    ),
  updatePortal: (id: string, data: Partial<PortalConfig>) =>
    fetchApi<PortalConfig>(`${getCpApiUrl()}/cp/portals/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  enablePortal: (id: string) =>
    fetchApi<PortalConfig>(`${getCpApiUrl()}/cp/portals/${id}/enable`, { method: "POST", body: "{}" }),
  disablePortal: (id: string) =>
    fetchApi<PortalConfig>(`${getCpApiUrl()}/cp/portals/${id}/disable`, { method: "POST", body: "{}" }),

  // System
  getSystemStatus: () => fetchApi<SystemStatus>(`${getCpApiUrl()}/cp/system/status`),
  getHealth: () => fetchApi<HealthStatus>(`${getCpApiUrl()}/cp/health`),

  // Dashboard history (agent/job activity graph, 7-day retention)
  getDashboardHistory: (period?: "24h" | "3d" | "7d") => {
    const q = period ? `?period=${period}` : "";
    return fetchApi<DashboardHistoryData>(`${getCpApiUrl()}/cp/dashboard/history${q}`);
  },

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
  /** Delete all jobs for the current tenant. */
  clearAllJobs: () =>
    fetchApi<{ deleted: number }>(`${getCpApiUrl()}/cp/jobs`, { method: "DELETE" }),
  getJob: (id: string) => fetchApi<Job>(`${getCpApiUrl()}/cp/jobs/${id}`),
  // Batch get job statuses for performance
  batchGetJobStatuses: (ids: string[]) =>
    fetchApi<Record<string, string | null>>(`${getCpApiUrl()}/cp/jobs/batch-status`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  stopJob: (id: string, reason?: string) =>
    fetchApi<{ job: Job; message: string }>(`${getCpApiUrl()}/cp/jobs/${id}/stop`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  retryJob: (id: string) =>
    fetchApi<{ job: Job; message: string }>(`${getCpApiUrl()}/cp/jobs/${id}/retry`, {
      method: "POST",
      body: "{}",
    }),
  requeueJob: (id: string) =>
    fetchApi<{ job: Job; message: string }>(`${getCpApiUrl()}/cp/jobs/${id}/requeue`, {
      method: "POST",
      body: "{}",
    }),
  getJobEvents: (id: string, limit?: number) => {
    const query = limit ? `?limit=${limit}` : "";
    return fetchApi<{ items: JobEvent[]; total: number }>(`${getCpApiUrl()}/cp/jobs/${id}/events${query}`);
  },
  getJobRuns: (id: string) =>
    fetchApi<{ items: JobRun[]; total: number; retry_count: number }>(`${getCpApiUrl()}/cp/jobs/${id}/runs`),
  getJobScreenshots: (id: string) =>
    fetchApi<{ items: { job_id: string; filename: string; content_type: string }[] }>(`${getCpApiUrl()}/cp/screenshots/${id}`),

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
      body: "{}",
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
  testEmail: (params?: {
      to?: string;
      subject?: string;
      body?: string;
      smtp_host?: string;
      smtp_port?: number;
      smtp_user?: string;
      smtp_pass?: string;
      smtp_from?: string;
      smtp_secure?: boolean;
    }) =>
    fetchApi<{ channel: string; message: string; details: Record<string, unknown> }>(
      `${getCpApiUrl()}/cp/notify/test/email`,
      { method: "POST", body: JSON.stringify(params ?? {}) }
    ),

  sendBugReport: (params: {
    title: string;
    description: string;
    timeWindowMinutes: number;
    to?: string;
    attachmentBase64?: string;
    attachmentName?: string;
    attachmentMime?: string;
  }) =>
    fetchApi<{ sent_to: string }>(
      `${getCpApiUrl()}/cp/bug-report`,
      { method: "POST", body: JSON.stringify(params) }
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
  getWatcherRunHistory: (limit?: number) => {
    const q = limit != null ? `?limit=${limit}` : "";
    return fetchApi<{ items: WatcherRunHistoryItem[]; total: number }>(`${getCpApiUrl()}/cp/watcher/run-history${q}`);
  },
  clearWatcherRunHistory: () =>
    fetchApi<{ success: boolean; data: { deleted: number } }>(`${getCpApiUrl()}/cp/watcher/run-history`, { method: "DELETE" }),
  clearWatcherSnapshots: () =>
    fetchApi<{ success: boolean; data: { deleted: number } }>(`${getCpApiUrl()}/cp/watcher/snapshots`, { method: "DELETE" }),
  getOpenSlots: () =>
    fetchApi<PortalOpenSlots[]>(`${getCpApiUrl()}/cp/watcher/slots`),
  grabBooking: (data: { customer_id: string; portal_id: string; open_dates: string[]; preferred_date?: string }) =>
    fetchApi<{ job_id: string; agent_id: string; agent_name: string; open_dates_count: number; message: string }>(
      `${getCpApiUrl()}/cp/watcher/grab-booking`,
      { method: "POST", body: JSON.stringify(data) }
    ),
  getWatcherInterval: () =>
    fetchApi<WatcherIntervalConfig>(`${getCpApiUrl()}/cp/watcher/interval`),
  updateWatcherInterval: (data: WatcherIntervalUpdate) =>
    fetchApi<WatcherIntervalConfig>(`${getCpApiUrl()}/cp/watcher/interval`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  getSnapshots: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return fetchApi<{ items: WatcherSnapshot[]; total: number }>(`${getCpApiUrl()}/cp/watcher/snapshots${query}`);
  },
  updateSnapshotArchive: (id: string, archived: boolean, archiveSummary?: string) =>
    fetchApi<WatcherSnapshot>(`${getCpApiUrl()}/cp/watcher/snapshots/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ archived, ...(archiveSummary !== undefined && { archive_summary: archiveSummary }) }),
    }),
  getSnapshot: (id: string) =>
    fetchApi<WatcherSnapshotFull>(`${getCpApiUrl()}/cp/watcher/snapshots/${id}`),
  getLatestArchivedSnapshot: (portalId: string, excludeSnapshotId?: string) => {
    const params = new URLSearchParams({ portal_id: portalId });
    if (excludeSnapshotId) params.set("exclude_snapshot_id", excludeSnapshotId);
    return fetchApi<WatcherSnapshotFull>(`${getCpApiUrl()}/cp/watcher/snapshots/latest-archived?${params}`);
  },
  getSnapshotHtml: (id: string) =>
    fetch(`${getCpApiUrl()}/cp/watcher/snapshots/${id}/html`, {
      headers: { "x-tenant-id": getTenantId() },
    }).then((r) => r.text()),
  getLatestDiff: (portalId: string) =>
    fetchApi<WatcherDiff>(`${getCpApiUrl()}/cp/watcher/diffs/latest?portal_id=${portalId}`),

  // Settings (system_settings: mock, notify, etc.)
  settings: {
    getCategory: (category: string) =>
      fetchApi<Record<string, Record<string, unknown>>>(
        `${getCpApiUrl()}/cp/settings?category=${encodeURIComponent(category)}`
      ).then((res) => (res && res[category] && typeof res[category] === "object" ? res[category] as Record<string, unknown> : {})),
    setValue: (category: string, key: string, value: unknown, description?: string) =>
      fetchApi<SystemSetting>(
        `${getCpApiUrl()}/cp/settings/${category}/${key}`,
        { method: "PUT", body: JSON.stringify({ value, description }) }
      ) as Promise<SystemSetting>,
    bulkUpdate: (updates: Array<{ category: string; key: string; value: unknown }>) =>
      fetchApi(`${getCpApiUrl()}/cp/settings/bulk`, {
        method: "PATCH",
        body: JSON.stringify({ updates }),
      }),
    getGlobalSettings: (): Promise<{ items: SystemSetting[]; total: number }> =>
      fetchApi<{ items: SystemSetting[]; total: number }>(`${getCpApiUrl()}/cp/settings/global`).then(
        (res) => res ?? { items: [], total: 0 }
      ),
    setGlobalValue: (category: string, key: string, value: unknown, description?: string) =>
      fetchApi<SystemSetting>(
        `${getCpApiUrl()}/cp/settings/global/${category}/${key}`,
        { method: "PUT", body: JSON.stringify({ value, description }) }
      ) as Promise<SystemSetting>,
  },

  // Mock Portal (proxied through CP to avoid browser DNS issues with Docker hostnames)
  mockPortal: {
    getConfig: (portalId: string) =>
      fetchApi<{ portalId: string; slots: { hasAvailability: boolean; availableTimes: string[]; randomizeAvailability: boolean; slotDisappearChance: number } }>(
        `${getCpApiUrl()}/cp/mock-portal/${encodeURIComponent(portalId)}/config`,
        {},
        15000
      ),
    setConfig: (portalId: string, body: unknown) =>
      fetchApi<{ portalId: string; slots: { hasAvailability: boolean } }>(
        `${getCpApiUrl()}/cp/mock-portal/${encodeURIComponent(portalId)}/config`,
        { method: "POST", body: JSON.stringify(body) },
        15000
      ),
  },
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
  is_scout: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateProfileData {
  name: string;
  description?: string;
  config: Record<string, unknown>;
  is_default?: boolean;
  is_scout?: boolean;
}

export interface PortalConfig {
  id: string;
  tenant_id: string;
  name: string;
  base_url?: string | null;
  enabled: boolean;
  config: Record<string, unknown>;
  selectors?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  portal_id: string;
}

/** Portal-specific customer form: fields shown when adding/editing a customer for this portal. Agent uses these values (stored in customer.preferences). */
export interface CustomerFormFieldSchema {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
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

export interface JobRun {
  id: string;
  job_id: string;
  tenant_id: string;
  worker_id: string;
  agent_id: string | null;
  agent_name: string | null;
  attempt_number: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
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
  memory_percent?: number;
  load_1m?: number;
  cpu_count?: number;
  job_stats: { total: number; active: number; completed: number };
  agent_stats: { total: number; online: number; offline: number };
}

export interface DashboardHistoryPoint {
  timestamp: string;
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

export interface DashboardHistoryData {
  period: string;
  points: DashboardHistoryPoint[];
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  checks: Record<string, { status: string; latency_ms?: number }>;
}

export interface AuditLog {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  actor_type: string;
  actor_name?: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type HitlTaskType =
  | "TURNSTILE"
  | "CAPTCHA"
  | "OTP"
  | "SECURITY_CODE"
  | "DOCUMENT_CLARIFICATION"
  | "MANUAL_REVIEW"
  | "CUSTOM_INPUT";

export type HitlTaskStatus =
  | "PENDING"
  | "ASSIGNED"
  | "RESOLVED"
  | "EXPIRED"
  | "CANCELLED"
  | "ESCALATED";

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
  escalation_reason?: string | null;
  escalated_at?: string | null;
  escalated_by?: string | null;
}

export interface ScaleResponse {
  current_async: number;
  current_sync: number;
  target_async: number;
  target_sync: number;
  scaling_in_progress: boolean;
}

export interface NotifyEventRouting {
  telegram?: boolean;
  email?: boolean;
}

export interface NotifyRouting {
  slot_open?: NotifyEventRouting;
  booking?: NotifyEventRouting;
  agent_start?: NotifyEventRouting;
  agent_done?: NotifyEventRouting;
  agent_fail?: NotifyEventRouting;
  hitl?: NotifyEventRouting;
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
  notify_routing: NotifyRouting;
  booking_send_to_customer: boolean;
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
  notify_routing?: NotifyRouting;
  booking_send_to_customer?: boolean;
}

// Watcher types
export type WatcherDiffMode = "hash" | "selector";

export interface WatcherConfig {
  id: string;
  tenant_id: string;
  enabled: boolean;
  time_window_enabled: boolean;
  window_start_hour: number;
  window_end_hour: number;
  jitter_minutes: number;
  portals: string[] | null;
  notify_on_change: boolean;
  diff_mode: WatcherDiffMode;
  run_retention_days?: number;
  snapshot_retention_days?: number;
  html_diff_interval?: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateWatcherConfigRequest {
  enabled?: boolean;
  time_window_enabled?: boolean;
  window_start_hour?: number;
  window_end_hour?: number;
  jitter_minutes?: number;
  portals?: string[];
  notify_on_change?: boolean;
  diff_mode?: WatcherDiffMode;
  run_retention_days?: number;
  snapshot_retention_days?: number;
  html_diff_interval?: string;
}

export interface WatcherRunResult {
  triggered: boolean;
  portals: string[];
  jobs_created?: number;
  message: string;
  estimated_completion?: string;
}

export interface WatcherIntervalConfig {
  fixed_ms: number;
  jitter_ms: number;
}

export interface WatcherIntervalUpdate {
  fixed_ms?: number;
  jitter_ms?: number;
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
  archived?: boolean;
  archived_at?: string | null;
}

export interface WatcherSnapshotFull extends WatcherSnapshot {
  tenant_id: string;
  html: string;
  screenshot_path: string | null;
  previous_snapshot_id: string | null;
}

export interface WatcherRunHistoryItem {
  id: string;
  run_at: string;
  portals_checked: string[];
  jobs_created: number;
  up_portal_ids: string[];
  down_portal_ids: string[];
  up_portals_with_no_customers: string[];
  message: string | null;
}

export interface PortalOpenSlots {
  portal_id: string;
  portal_name: string;
  open_dates: string[];
  last_checked_at: string | null;
  matching_customers: number;
  total_active_customers: number;
}

export interface WatcherStatus {
  config: WatcherConfig | null;
  status: "not_configured" | "enabled" | "disabled";
  disabled_reason?: string | null;
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
  /** Portal-specific fields (keys from portal customerFormSchema); agent uses these. */
  [key: string]: unknown;
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
    const res = await fetchApi<SettingsGrouped>(`${getCpApiUrl()}/cp/settings`);
    return res ?? {};
  },

  /** Get settings for a single category (e.g. mock). Returns record of key -> value. */
  async getCategory(category: string): Promise<Record<string, unknown>> {
    const res = await fetchApi<Record<string, Record<string, unknown>>>(
      `${getCpApiUrl()}/cp/settings?category=${encodeURIComponent(category)}`
    );
    const cat = res?.[category];
    return (cat && typeof cat === "object") ? cat : {};
  },

  async getList(category?: string): Promise<{ items: SystemSetting[]; total: number }> {
    const query = category ? `?category=${category}` : '';
    const res = await fetchApi<{ items: SystemSetting[]; total: number }>(
      `${getCpApiUrl()}/cp/settings/list${query}`
    );
    return res ?? { items: [], total: 0 };
  },

  async getCategories(): Promise<string[]> {
    const res = await fetchApi<{ categories: string[] }>(
      `${getCpApiUrl()}/cp/settings/categories`
    );
    return res?.categories ?? [];
  },

  async getValue(category: string, key: string): Promise<unknown> {
    const res = await fetchApi<{ value: unknown }>(
      `${getCpApiUrl()}/cp/settings/${category}/${key}`
    );
    return res?.value;
  },

  async setValue(category: string, key: string, value: unknown, description?: string): Promise<SystemSetting> {
    return fetchApi<SystemSetting>(
      `${getCpApiUrl()}/cp/settings/${category}/${key}`,
      {
        method: 'PUT',
        body: JSON.stringify({ value, description }),
      }
    ) as Promise<SystemSetting>;
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
    const res = await fetchApi<{ items: SystemSetting[]; total: number }>(
      `${getCpApiUrl()}/cp/settings/global`
    );
    return res ?? { items: [], total: 0 };
  },

  async setGlobalValue(category: string, key: string, value: unknown, description?: string): Promise<SystemSetting> {
    return fetchApi<SystemSetting>(
      `${getCpApiUrl()}/cp/settings/global/${category}/${key}`,
      {
        method: 'PUT',
        body: JSON.stringify({ value, description }),
      }
    ) as Promise<SystemSetting>;
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
    const empty = { items: [] as Customer[], total: 0, counts: { active: 0, paused: 0, completed: 0, cancelled: 0 } as CustomerCounts };
    const res = await fetchApi<{ items: Customer[]; total: number; counts: CustomerCounts }>(
      `${getCpApiUrl()}/cp/customers${query}`
    );
    return res ?? empty;
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

  async create(customer: Omit<Customer, 'id' | 'tenant_id' | 'total_jobs' | 'successful_bookings' | 'last_job_at' | 'last_slot_found_at' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by' | 'profile_id'> & { profile_id?: string | null }): Promise<Customer> {
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
      body: '{}',
    }).then(r => r.data);
  },

  async resume(id: string): Promise<Customer> {
    return fetchApi<{ data: Customer }>(`${getCpApiUrl()}/cp/customers/${id}/resume`, {
      method: 'POST',
      body: '{}',
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

  async triggerSlotCheck(id: string): Promise<{ message: string; customer_id: string; job_id: string; agent_id?: string; agent_name?: string }> {
    return fetchApi<{ message: string; customer_id: string; job_id: string; agent_id?: string; agent_name?: string }>(
      `${getCpApiUrl()}/cp/customers/${id}/run-slot-check`,
      { method: 'POST', body: '{}' }
    );
  },

  async triggerBooking(id: string): Promise<{ message: string; customer_id: string; job_id: string; agent_id?: string; agent_name?: string }> {
    return fetchApi<{ message: string; customer_id: string; job_id: string; agent_id?: string; agent_name?: string }>(
      `${getCpApiUrl()}/cp/customers/${id}/run-booking`,
      { method: 'POST', body: '{}' }
    );
  },

  async bulkAction(action: 'pause' | 'resume' | 'assign_profile' | 'update_status', ids: string[], options?: { profile_id?: string; status?: CustomerStatus }): Promise<{ affected: number }> {
    return fetchApi<{ data: { affected: number } }>(`${getCpApiUrl()}/cp/customers/bulk`, {
      method: 'POST',
      body: JSON.stringify({ action, ids, ...options }),
    }).then(r => r.data);
  },
};

// =====================================================
// Staff Management API
// =====================================================
export type StaffRole = 'staff' | 'admin' | 'super_admin';
export type StaffStatus = 'active' | 'inactive' | 'suspended' | 'pending';

export interface StaffMember {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: StaffRole;
  avatar_url: string | null;
  status: StaffStatus;
  permissions: string[];
  settings: {
    max_concurrent_tasks?: number;
    notification_sound?: boolean;
    preferred_task_types?: string[];
  };
  metrics: {
    total_tasks?: number;
    resolved_tasks?: number;
    expired_tasks?: number;
    avg_resolution_time_ms?: number;
    success_rate?: number;
  };
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffActivityLog {
  id: string;
  tenant_id: string;
  staff_id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface StaffDashboardStats {
  totalStaff: number;
  activeStaff: number;
  onlineNow: number;
  tasksToday: number;
  avgResolutionTime: string;
}

export interface StaffLeaderboardEntry {
  staffId: string;
  name: string;
  resolved: number;
  avgTime: number;
}

export const staffApi = {
  // Login with email + password — returns staff info (no password_hash)
  async login(email: string, password: string, tenantId = 'default'): Promise<{ staff: StaffMember; tenant_id: string }> {
    return fetchApi<{ staff: StaffMember; tenant_id: string }>(`${getCpApiUrl()}/cp/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email, password, tenant_id: tenantId }),
    });
  },

  // List staff members
  async list(filters?: {
    status?: StaffStatus;
    role?: StaffRole;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: StaffMember[]; total: number }> {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.role) params.append('role', filters.role);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.offset) params.append('offset', String(filters.offset));
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchApi<{ items: StaffMember[]; total: number }>(`${getCpApiUrl()}/cp/staff${query}`);
  },

  // Get single staff member
  async getById(id: string): Promise<StaffMember> {
    return fetchApi<StaffMember>(`${getCpApiUrl()}/cp/staff/${id}`);
  },

  // Auth: get invite details by token (for register page)
  async getInviteByToken(token: string): Promise<{ email: string; name: string }> {
    return fetchApi<{ email: string; name: string }>(`${getCpApiUrl()}/cp/auth/invite/${encodeURIComponent(token)}`);
  },

  // Auth: complete registration (set password with invite token)
  async completeRegistration(token: string, password: string): Promise<{ message: string; staff: StaffMember }> {
    const data = await fetchApi<{ message: string; staff: StaffMember }>(`${getCpApiUrl()}/cp/auth/complete-registration`, {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
    return data;
  },

  // Get staff by email (for login suspended check; returns null if not found)
  async getByEmail(email: string): Promise<StaffMember | null> {
    const q = new URLSearchParams({ email: email.trim() });
    try {
      const data = await fetchApi<StaffMember>(`${getCpApiUrl()}/cp/staff/by-email?${q}`);
      return data;
    } catch {
      return null;
    }
  },

  // Create staff member
  async create(staff: {
    email: string;
    name: string;
    role?: StaffRole;
    permissions?: string[];
    settings?: Record<string, unknown>;
  }): Promise<StaffMember & { email_sent: boolean; invite_url?: string }> {
    return fetchApi<StaffMember & { email_sent: boolean; invite_url?: string }>(`${getCpApiUrl()}/cp/staff`, {
      method: 'POST',
      body: JSON.stringify(staff),
    });
  },

  // Update staff member (email only allowed for super_admin)
  async update(id: string, updates: Partial<{
    name: string;
    email: string;
    role: StaffRole;
    status: StaffStatus;
    permissions: string[];
    settings: Record<string, unknown>;
    avatar_url: string;
  }>): Promise<StaffMember> {
    return fetchApi<StaffMember>(`${getCpApiUrl()}/cp/staff/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  // Delete staff member
  async delete(id: string): Promise<void> {
    await fetchApi(`${getCpApiUrl()}/cp/staff/${id}`, {
      method: 'DELETE',
    });
  },

  // Suspend staff member
  async suspend(id: string): Promise<StaffMember> {
    return fetchApi<StaffMember>(`${getCpApiUrl()}/cp/staff/${id}/suspend`, {
      method: 'POST',
      body: '{}',
    });
  },

  // Activate staff member
  async activate(id: string): Promise<StaffMember> {
    return fetchApi<StaffMember>(`${getCpApiUrl()}/cp/staff/${id}/activate`, {
      method: 'POST',
      body: '{}',
    });
  },

  // Get activity log
  async getActivityLog(filters?: {
    staff_id?: string;
    action?: string;
    resource_type?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: StaffActivityLog[]; total: number }> {
    const params = new URLSearchParams();
    if (filters?.staff_id) params.append('staff_id', filters.staff_id);
    if (filters?.action) params.append('action', filters.action);
    if (filters?.resource_type) params.append('resource_type', filters.resource_type);
    if (filters?.start_date) params.append('start_date', filters.start_date);
    if (filters?.end_date) params.append('end_date', filters.end_date);
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.offset) params.append('offset', String(filters.offset));
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchApi<{ items: StaffActivityLog[]; total: number }>(`${getCpApiUrl()}/cp/staff/activity${query}`);
  },

  // Get staff member's activity
  async getStaffActivity(staffId: string, filters?: {
    action?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: StaffActivityLog[]; total: number }> {
    const params = new URLSearchParams();
    if (filters?.action) params.append('action', filters.action);
    if (filters?.limit) params.append('limit', String(filters.limit));
    if (filters?.offset) params.append('offset', String(filters.offset));
    const query = params.toString() ? `?${params.toString()}` : '';
    return fetchApi<{ items: StaffActivityLog[]; total: number }>(`${getCpApiUrl()}/cp/staff/${staffId}/activity${query}`);
  },

  // Get dashboard stats
  async getDashboardStats(): Promise<StaffDashboardStats> {
    return fetchApi<StaffDashboardStats>(`${getCpApiUrl()}/cp/staff/dashboard`);
  },

  // Get leaderboard
  async getLeaderboard(period: 'today' | 'week' | 'month' | 'all' = 'week'): Promise<StaffLeaderboardEntry[]> {
    return fetchApi<StaffLeaderboardEntry[]>(`${getCpApiUrl()}/cp/staff/leaderboard?period=${period}`);
  },

  // Set password for a staff member (super_admin only)
  async setPassword(id: string, password: string): Promise<void> {
    await fetchApi(`${getCpApiUrl()}/cp/staff/${id}/set-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },

  // Resend invite email (or get invite URL if SMTP not configured)
  async resendInvite(id: string): Promise<{ email_sent: boolean; invite_url?: string }> {
    return fetchApi<{ email_sent: boolean; invite_url?: string }>(`${getCpApiUrl()}/cp/staff/${id}/resend-invite`, {
      method: 'POST',
      body: '{}',
    });
  },

  // Get online staff
  async getOnlineStaff(): Promise<Array<{ staff: StaffMember; status: string }>> {
    return fetchApi<Array<{ staff: StaffMember; status: string }>>(`${getCpApiUrl()}/cp/staff/online`);
  },
};
