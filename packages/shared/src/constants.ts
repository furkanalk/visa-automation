/**
 * Application-wide constants
 */

/**
 * Default configuration values
 */
export const DEFAULTS = {
  /** Default job priority (0-100, higher = more priority) */
  JOB_PRIORITY: 50,
  
  /** Default max retries for failed jobs */
  MAX_RETRIES: 3,
  
  /** Default HITL timeout in minutes */
  HITL_TIMEOUT_MINUTES: 30,
  
  /** Default max concurrent jobs per tenant */
  MAX_CONCURRENT_JOBS: 5,
  
  /** Page size for pagination */
  PAGE_SIZE: 20,
  
  /** Max page size */
  MAX_PAGE_SIZE: 100,
} as const;

/**
 * HTTP status codes
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * Error codes for structured error responses
 */
export const ERROR_CODES = {
  // Authentication & Authorization errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  
  // Resource errors
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  HITL_TASK_NOT_FOUND: 'HITL_TASK_NOT_FOUND',
  
  // State errors
  JOB_ALREADY_COMPLETED: 'JOB_ALREADY_COMPLETED',
  JOB_ALREADY_CANCELLED: 'JOB_ALREADY_CANCELLED',
  HITL_TASK_EXPIRED: 'HITL_TASK_EXPIRED',
  
  // Processing errors
  BROWSER_ERROR: 'BROWSER_ERROR',
  SITE_UNAVAILABLE: 'SITE_UNAVAILABLE',
  CAPTCHA_DETECTED: 'CAPTCHA_DETECTED',
  OTP_REQUIRED: 'OTP_REQUIRED',
  
  // System errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  QUEUE_ERROR: 'QUEUE_ERROR',
} as const;
