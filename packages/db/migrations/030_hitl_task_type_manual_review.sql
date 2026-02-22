-- Add MANUAL_REVIEW to hitl_task_type (code uses MANUAL_REVIEW; DB had only MANUAL_VERIFICATION)
DO $$
BEGIN
  ALTER TYPE hitl_task_type ADD VALUE 'MANUAL_REVIEW';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
