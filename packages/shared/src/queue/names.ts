/**
 * BullMQ Queue Names (no colons - BullMQ disallows ":" in queue names)
 */
export const QUEUE_NAMES = {
  /** Main job processing queue */
  JOB_PROCESSING: 'visa-jobs',

  /** Slot-check (scout/watcher) queue; only agents with scout profile consume from this */
  SLOT_CHECK: 'visa-slot-check',

  /**
   * Per-agent SYNC queue prefix. Full queue name = SYNC_AGENT_PREFIX + agentId.
   * CP pushes directly to this queue when assigning a job to a specific SYNC agent.
   * The SyncAgentRunner on DP subscribes each SYNC agent to its own queue.
   * BullMQ does not allow ":" in queue names, so we use "__" as separator.
   */
  SYNC_AGENT_PREFIX: 'visa-sync__',

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
