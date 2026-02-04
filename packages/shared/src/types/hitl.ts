/**
 * HITL Task - Human-in-the-Loop intervention request
 */
export interface HitlTask {
  id: string;
  job_id: string;
  job_run_id: string;
  tenant_id: string;
  type: HitlTaskType;
  status: HitlTaskStatus;
  context: HitlContext;
  resolution?: HitlResolution;
  expires_at: Date;
  created_at: Date;
  resolved_at?: Date;
  resolved_by?: string;
}

export type HitlTaskType = 
  | 'CAPTCHA'
  | 'OTP'
  | 'DOCUMENT_CLARIFICATION'
  | 'MANUAL_VERIFICATION'
  | 'CUSTOM_INPUT';

export type HitlTaskStatus = 
  | 'PENDING'
  | 'ASSIGNED'
  | 'RESOLVED'
  | 'EXPIRED'
  | 'CANCELLED';

/**
 * Context passed to HITL resolver
 */
export interface HitlContext {
  screenshot_url?: string;
  html_snapshot_url?: string;
  prompt: string;
  input_type: 'text' | 'select' | 'file' | 'checkbox';
  options?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Resolution provided by human operator
 */
export interface HitlResolution {
  value: string;
  confidence?: number;
  notes?: string;
}

/**
 * Request to resolve a HITL task
 */
export interface ResolveHitlRequest {
  task_id: string;
  resolution: HitlResolution;
  resolved_by: string;
}
