-- Add TURNSTILE to hitl_task_type enum (used when job hits Turnstile/CAPTCHA and needs HITL)
DO $$
BEGIN
  ALTER TYPE hitl_task_type ADD VALUE 'TURNSTILE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
