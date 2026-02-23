import type { JobState } from './states.js';

/**
 * Valid state transitions for the FSM
 * Key: current state, Value: array of valid next states
 */
export const VALID_TRANSITIONS: Record<JobState, JobState[]> = {
  // From QUEUED
  QUEUED: ['LOGIN_PROCESS', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  
  // From LOGIN_PROCESS
  LOGIN_PROCESS: ['LOGGED_IN', 'WAITING_HITL', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  
  // From LOGGED_IN (slot-check jobs skip FORM_FILLING/PROCESSING and go straight to SLOT_SEARCHING)
  LOGGED_IN: ['FORM_FILLING', 'SLOT_SEARCHING', 'WAITING_HITL', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  
  // From FORM_FILLING
  FORM_FILLING: ['PROCESSING', 'WAITING_HITL', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  
  // From PROCESSING
  PROCESSING: ['SLOT_SEARCHING', 'WAITING_SLOT', 'COMPLETED', 'WAITING_HITL', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  
  // From SLOT_SEARCHING
  SLOT_SEARCHING: ['SLOT_FOUND', 'WAITING_HITL', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'PAUSED', 'CANCELLED'],
  
  // From SLOT_FOUND (slot-check flow can go to WAITING_SLOT/COMPLETED; booking flow to PAYMENT etc.)
  SLOT_FOUND: ['PAYMENT', 'WAITING_SLOT', 'COMPLETED', 'WAITING_HITL', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  
  // From PAYMENT
  PAYMENT: ['COMPLETED', 'WAITING_HITL', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'],
  
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
