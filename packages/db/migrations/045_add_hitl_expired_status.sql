-- Migration: 045_add_hitl_expired_status
-- Description: Add HITL_EXPIRED to job_status enum for when a HITL task times out without resolution

ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'HITL_EXPIRED';

COMMENT ON TYPE job_status IS 'Job execution states. HITL_EXPIRED means operator did not resolve the HITL task in time.';
