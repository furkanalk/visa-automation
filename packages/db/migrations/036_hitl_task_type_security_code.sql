-- Add SECURITY_CODE to hitl_task_type (AS-VISA 6-digit code input uses this; code already sends it)
DO $$
BEGIN
  ALTER TYPE hitl_task_type ADD VALUE 'SECURITY_CODE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
