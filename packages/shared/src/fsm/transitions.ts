import type { JobState } from './states.js';

/**
 * Valid state transitions for the FSM
 * Key: current state, Value: array of valid next states
 */
export const VALID_TRANSITIONS: Record<JobState, JobState[]> = {
  // From QUEUED
  QUEUED: ['LOGIN_PROCESS', 'CANCELLED'],
  
  // From LOGIN_PROCESS
  LOGIN_PROCESS: ['LOGGED_IN', 'WAITING_HITL', 'FAILED_RETRYABLE', 'CANCELLED'],
  
  // From LOGGED_IN
  LOGGED_IN: ['FORM_FILLING', 'WAITING_HITL', 'FAILED_RETRYABLE', 'CANCELLED'],
  
  // From FORM_FILLING
  FORM_FILLING: ['PROCESSING', 'WAITING_HITL', 'FAILED_RETRYABLE', 'CANCELLED'],
  
  // From PROCESSING
  PROCESSING: ['SLOT_SEARCHING', 'WAITING_SLOT', 'COMPLETED', 'WAITING_HITL', 'FAILED_RETRYABLE', 'CANCELLED'],
  
  // From SLOT_SEARCHING
  SLOT_SEARCHING: ['SLOT_FOUND', 'WAITING_HITL', 'FAILED_RETRYABLE', 'PAUSED', 'CANCELLED'],
  
  // From SLOT_FOUND
  SLOT_FOUND: ['PAYMENT', 'WAITING_HITL', 'FAILED_RETRYABLE', 'CANCELLED'],
  
  // From PAYMENT
  PAYMENT: ['COMPLETED', 'WAITING_HITL', 'FAILED_RETRYABLE', 'CANCELLED'],
  
  // From WAITING_SLOT - can retry processing or cancel
  WAITING_SLOT: ['PROCESSING', 'CANCELLED'],
  
  // From WAITING_HITL - can return to any processing state
  WAITING_HITL: [
    'LOGIN_PROCESS',
    'LOGGED_IN',
    'FORM_FILLING',
    'PROCESSING',
    'SLOT_SEARCHING',
    'SLOT_FOUND',
    'PAYMENT',
    'FAILED_RETRYABLE',
    'FAILED_TERMINAL',
    'CANCELLED',
  ],
  
  // From PAUSED
  PAUSED: ['QUEUED', 'CANCELLED'],
  
  // From FAILED_RETRYABLE
  FAILED_RETRYABLE: ['QUEUED', 'FAILED_TERMINAL'],
  
  // Terminal states - no transitions out
  COMPLETED: [],
  FAILED_TERMINAL: [],
  CANCELLED: [],
};

/**
 * Check if a transition is valid
 */
export function isValidTransition(from: JobState, to: JobState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get all valid next states from current state
 */
export function getValidNextStates(currentState: JobState): JobState[] {
  return VALID_TRANSITIONS[currentState] ?? [];
}

/**
 * State transition event for logging
 */
export interface StateTransitionEvent {
  job_id: string;
  from_state: JobState;
  to_state: JobState;
  timestamp: Date;
  worker_id?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}
