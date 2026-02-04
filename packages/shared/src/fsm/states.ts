/**
 * FSM States for visa automation jobs
 * Based on VISA_FSM_DESIGN.md specification
 */
export const JOB_STATES = {
  // Initial state
  QUEUED: 'QUEUED',
  
  // Processing states
  LOGIN_PROCESS: 'LOGIN_PROCESS',
  LOGGED_IN: 'LOGGED_IN',
  FORM_FILLING: 'FORM_FILLING',
  PROCESSING: 'PROCESSING',
  SLOT_SEARCHING: 'SLOT_SEARCHING',
  SLOT_FOUND: 'SLOT_FOUND',
  PAYMENT: 'PAYMENT',
  
  // Wait states
  WAITING_HITL: 'WAITING_HITL',
  PAUSED: 'PAUSED',
  
  // Terminal states
  COMPLETED: 'COMPLETED',
  FAILED_RETRYABLE: 'FAILED_RETRYABLE',
  FAILED_TERMINAL: 'FAILED_TERMINAL',
  CANCELLED: 'CANCELLED',
} as const;

export type JobState = typeof JOB_STATES[keyof typeof JOB_STATES];

/**
 * State categories for quick classification
 */
export const TERMINAL_STATES: JobState[] = [
  'COMPLETED',
  'FAILED_TERMINAL',
  'CANCELLED',
];

export const PROCESSING_STATES: JobState[] = [
  'LOGIN_PROCESS',
  'LOGGED_IN',
  'FORM_FILLING',
  'PROCESSING',
  'SLOT_SEARCHING',
  'SLOT_FOUND',
  'PAYMENT',
];

export const WAIT_STATES: JobState[] = [
  'WAITING_HITL',
  'PAUSED',
];

/**
 * Check if a state is terminal
 */
export function isTerminalState(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * Check if a state allows processing to continue
 */
export function isProcessingState(state: JobState): boolean {
  return PROCESSING_STATES.includes(state);
}

/**
 * Check if a state requires waiting
 */
export function isWaitState(state: JobState): boolean {
  return WAIT_STATES.includes(state);
}
