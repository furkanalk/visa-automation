-- Migration: Add WAITING_SLOT to job_status enum
-- Created: 2026-02-09
-- Purpose: Support slot polling retry state in FSM

-- Add WAITING_SLOT value to job_status enum if it doesn't exist
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'WAITING_SLOT';

-- Optional: Add comment for documentation
COMMENT ON TYPE job_status IS 'Job execution states including WAITING_SLOT for slot polling retry cycles';
