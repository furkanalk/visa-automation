/**
 * Notification Settings - per-tenant notification channel configuration
 */

/**
 * Per-event channel routing. Both fields default to true when not set.
 */
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
  telegram_bot_token?: string;
  telegram_chat_ids: string[];
  email_enabled: boolean;
  smtp_host?: string;
  smtp_port: number;
  smtp_user?: string;
  smtp_pass?: string;
  smtp_from?: string;
  smtp_secure: boolean;
  fallback_email?: string;
  email_override?: string;
  webhook_enabled: boolean;
  webhook_url?: string;
  webhook_secret?: string;
  notify_routing: NotifyRouting;
  booking_send_to_customer: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Request/Response types for Notify API
 */
export interface UpdateNotifySettingsRequest {
  telegram_enabled?: boolean;
  telegram_bot_token?: string;
  telegram_chat_ids?: string[];
  email_enabled?: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_pass?: string;
  smtp_from?: string;
  smtp_secure?: boolean;
  fallback_email?: string;
  email_override?: string;
  webhook_enabled?: boolean;
  webhook_url?: string;
  webhook_secret?: string;
  notify_routing?: NotifyRouting;
  booking_send_to_customer?: boolean;
}

export interface TestTelegramRequest {
  chat_id?: string;
  message?: string;
}

export interface TestEmailRequest {
  to?: string;
  subject?: string;
  body?: string;
  /** Optional: use these for test without saving (e.g. current form values). */
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_pass?: string;
  smtp_from?: string;
  smtp_secure?: boolean;
}

export interface TestNotifyResponse {
  success: boolean;
  channel: 'telegram' | 'email' | 'webhook';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Notification event types
 */
export type NotifyEventType =
  | 'SLOT_OPEN'
  | 'SLOT_CLOSED'
  | 'BOOKING_CONFIRMED'
  | 'JOB_COMPLETED'
  | 'JOB_FAILED'
  | 'HITL_REQUIRED'
  | 'HITL_TIMEOUT'
  | 'PORTAL_CHANGED'
  | 'AGENT_OFFLINE'
  | 'SYSTEM_ALERT';

export interface NotifyPayload {
  event_type: NotifyEventType;
  tenant_id: string;
  job_id?: string;
  portal_id?: string;
  agent_id?: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}
