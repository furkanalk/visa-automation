/**
 * BullMQ Queue Names (no colons - BullMQ disallows ":" in queue names)
 */
export const QUEUE_NAMES = {
  /** Main job processing queue */
  JOB_PROCESSING: 'visa-jobs',

  /** Slot-check (scout/watcher) queue; only agents with scout profile consume from this */
  SLOT_CHECK: 'visa-slot-check',

  /** HITL task notifications */
  HITL_NOTIFICATIONS: 'visa-hitl-notifications',

  /** General notifications (email, webhook, SMS) */
  NOTIFICATIONS: 'visa-notifications',

  /** Evidence pack generation */
  EVIDENCE_PACKS: 'visa-evidence',

  /** Scheduled/delayed jobs */
  SCHEDULED: 'visa-scheduled',
} as const;

export type QueueName = typeof QUEUE_NAMES[keyof typeof QUEUE_NAMES];

/**
 * Redis key prefixes
 */
export const REDIS_KEYS = {
  /** Worker lease prefix */
  WORKER_LEASE: 'visa:worker:lease:',
  
  /** Job lock prefix */
  JOB_LOCK: 'visa:job:lock:',
  
  /** Rate limit prefix */
  RATE_LIMIT: 'visa:ratelimit:',
  
  /** Cache prefix */
  CACHE: 'visa:cache:',
} as const;
