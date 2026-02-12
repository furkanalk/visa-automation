// Runtime URL getter - supports localStorage override from Settings
const getCpApiUrl = () =>
  (typeof window !== "undefined" && localStorage.getItem("cp_api_url")) ||
  process.env.NEXT_PUBLIC_CP_API_URL ||
  "http://localhost:3001";

// Get tenant from localStorage (set by auth store) or default
const getTenantId = () =>
  (typeof window !== "undefined" && localStorage.getItem("staff_tenant_id")) ||
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

async function fetchApi<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-tenant-id": getTenantId(),
    ...(options.headers as Record<string, string>),
  };

  try {
    const response = await fetchWithTimeout(url, { ...options, headers }, 5000);
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

// Staff-specific API endpoints
export const staffApi = {
  // My Tasks - get tasks assigned to me or pending
  getMyTasks: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return fetchApi<{ items: HitlTask[]; total: number }>(`${getCpApiUrl()}/cp/hitl${query}`);
  },

  // Get single task with job context
  getTask: (id: string) =>
    fetchApi<{ task: HitlTask; job: Job | null }>(`${getCpApiUrl()}/cp/hitl/${id}`),

  // Assign task to self
  assignTask: (id: string, staffId: string) =>
    fetchApi<{ task: HitlTask; message: string }>(`${getCpApiUrl()}/cp/hitl/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ assigned_to: staffId }),
    }),

  // Resolve task
  resolveTask: (id: string, resolution: HitlResolution) =>
    fetchApi<{ task: HitlTask; message: string }>(`${getCpApiUrl()}/cp/hitl/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ resolution }),
    }),

  // Escalate task to admin
  escalateTask: (id: string, reason: string) =>
    fetchApi<{ task: HitlTask; message: string }>(`${getCpApiUrl()}/cp/hitl/${id}/escalate`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  // Get my task history
  getMyHistory: (staffId: string, params?: Record<string, string>) => {
    const searchParams = new URLSearchParams({
      resolved_by: staffId,
      status: "RESOLVED",
      ...params,
    });
    return fetchApi<{ items: HitlTask[]; total: number }>(
      `${getCpApiUrl()}/cp/hitl?${searchParams}`
    );
  },

  // Get pending count for badge
  getPendingCount: () => fetchApi<{ count: number }>(`${getCpApiUrl()}/cp/hitl/pending-count`),

  // Get notifications/feed
  getNotifications: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return fetchApi<{ items: Notification[]; total: number }>(
      `${getCpApiUrl()}/cp/staff/notifications${query}`
    );
  },

  // Mark notification as read
  markNotificationRead: (id: string) =>
    fetchApi<{ success: boolean }>(`${getCpApiUrl()}/cp/staff/notifications/${id}/read`, {
      method: "POST",
    }),
};

// Types
export type HitlTaskType =
  | "TURNSTILE"
  | "CAPTCHA"
  | "OTP"
  | "DOCUMENT_CLARIFICATION"
  | "MANUAL_REVIEW"
  | "CUSTOM_INPUT";

export type HitlTaskStatus = "PENDING" | "ASSIGNED" | "RESOLVED" | "EXPIRED" | "CANCELLED";

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
  assigned_to?: string;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface Job {
  id: string;
  tenant_id: string;
  external_ref: string | null;
  visa_type: string;
  status: string;
  applicant_data: Record<string, unknown>;
  created_at: string;
}

export interface Notification {
  id: string;
  type: "task_assigned" | "task_expired" | "escalation_response" | "system";
  title: string;
  message: string;
  read: boolean;
  created_at: string;
  metadata?: Record<string, unknown>;
}

// Customer types (redacted for staff view)
export interface RedactedCustomer {
  id: string;
  tenant_id: string;
  display_name: string;
  internal_ref: string | null;
  tags: string[];
  portal_id: string;
  status: "active" | "paused" | "completed" | "cancelled";
  priority: number;
  notify_email: string | null; // Redacted
  notify_phone: string | null; // Redacted
  preferences: {
    visa_type?: string;
    appointment_city?: string;
    preferred_dates?: { from: string; to: string };
    family_size?: number;
    special_requirements?: string[];
  };
  flags: {
    has_previous_refusal?: boolean;
    requires_otp_staff?: boolean;
    needs_family_booking?: boolean;
    has_travel_soon?: boolean;
    vip?: boolean;
  };
  total_jobs: number;
  successful_bookings: number;
  last_job_at: string | null;
  last_slot_found_at: string | null;
  created_at: string;
}

// Staff customer API (read-only, redacted)
export const customerApi = {
  // Get redacted customer view for a task
  getForTask: (customerId: string) =>
    fetchApi<RedactedCustomer>(`${getCpApiUrl()}/cp/customers/${customerId}/redacted`),

  // Get customer list (redacted, for reference)
  list: (params?: Record<string, string>) => {
    const query = params ? `?${new URLSearchParams(params)}` : "";
    return fetchApi<{ items: RedactedCustomer[]; total: number }>(
      `${getCpApiUrl()}/cp/customers${query}`
    );
  },
};
