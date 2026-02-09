import type { JobConfig, ApplicantData, VisaType } from '../types/job.js';
import type { JobState } from '../fsm/states.js';

/**
 * Payload for job processing queue
 */
export interface JobQueuePayload {
  job_id: string;
  portal_id: string; // (sonra PortalId yaparız; shared<->worker bağımlılığı şimdilik string kalsın)
  tenant_id: string;
  visa_type: VisaType;
  priority: number;
  applicant_data: ApplicantData;
  config: JobConfig;
  attempt_number: number;
  resume_from_state?: JobState;
  checkpoint_data?: Record<string, unknown>;
}

/**
 * Payload for HITL notification queue
 */
export interface HitlNotificationPayload {
  task_id: string;
  job_id: string;
  tenant_id: string;
  type: string;
  expires_at: Date;
  context: Record<string, unknown>;
}

/**
 * Payload for general notifications
 */
export interface NotificationPayload {
  tenant_id: string;
  job_id?: string;
  channel: 'EMAIL' | 'WEBHOOK' | 'SMS';
  event_type: string;
  recipient: string;
  data: Record<string, unknown>;
}

/**
 * Payload for evidence pack generation
 */
export interface EvidencePackPayload {
  job_id: string;
  tenant_id: string;
  screenshots: string[];
  html_snapshots: string[];
  timeline: Array<{
    timestamp: Date;
    state: string;
    message: string;
  }>;
  confirmation_number?: string;
}
