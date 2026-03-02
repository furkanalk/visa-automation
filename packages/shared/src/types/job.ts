import type { JobState } from '../fsm/states.js';

/**
 * Job entity - represents a visa application job
 */
export interface Job {
  id: string;
  tenant_id: string;
  external_ref?: string;
  visa_type: VisaType;
  status: JobState;
  priority: number;
  applicant_data: ApplicantData;
  config: JobConfig;
  retry_count: number;
  max_retries: number;
  locked_by?: string;
  locked_until?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export type VisaType = 'SCHENGEN' | 'UK' | 'US' | 'CANADA' | 'AUSTRALIA' | 'OTHER';

export interface ApplicantData {
  name: string;
  passport_number?: string;
  nationality?: string;
  date_of_birth?: string;
  email?: string;
  phone?: string;
  [key: string]: unknown;
}

export interface JobConfig {
  target_site?: string;
  appointment_date_range?: {
    start: string;
    end: string;
  };
  preferred_location?: string;
  simulate_hitl?: boolean;
  /** When true, job only checks for slot; if found, calls CP to create customer jobs (no booking) */
  slot_check_only?: boolean;
  /**
   * How this job was triggered.
   * 'manual'        – operator manually triggered (customers page, slots grab, manual watcher run)
   * 'watcher_auto'  – scheduled watcher run (no human present)
   * When a scout job creates customer booking jobs via slot-open:
   *   'manual' source      → booking job goes to SYNC agent (operator is watching)
   *   'watcher_auto' source → booking job goes to ASYNC queue (background)
   */
  triggered_by?: 'manual' | 'watcher_auto';
  [key: string]: unknown;
}

/**
 * Job Run - tracks individual execution attempts
 */
export interface JobRun {
  id: string;
  job_id: string;
  tenant_id: string;
  worker_id: string;
  attempt_number: number;
  status: JobRunStatus;
  started_at: Date;
  finished_at?: Date;
  error_code?: string;
  error_message?: string;
  checkpoint_data?: Record<string, unknown>;
}

export type JobRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * Request/Response types for API
 */
export interface CreateJobRequest {
  tenant_id: string; // Injected from auth context, NOT from request body
  portal_id: string;
  external_ref?: string;
  visa_type: VisaType;
  priority?: number;
  applicant: ApplicantData;
  config?: JobConfig;
}

/**
 * CreateJobBody - Request body from client (without tenant_id for security)
 * tenant_id must come from authentication context, not user input
 */
export interface CreateJobBody {
  external_ref?: string;
  visa_type: VisaType;
  priority?: number;
  applicant: ApplicantData;
  config?: JobConfig;
  portal_id: string;
}

export interface CreateJobResponse {
  job_id: string;
  status: JobState;
  message: string;
}

export interface JobStatusResponse {
  job_id: string;
  status: JobState;
  priority: number;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
  hitl_pending: boolean;
  current_step?: string;
}
