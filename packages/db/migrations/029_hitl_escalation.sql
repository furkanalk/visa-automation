-- Add ESCALATED to hitl_task_status (staff escalates to admin for review)
DO $$
BEGIN
  ALTER TYPE hitl_task_status ADD VALUE 'ESCALATED';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Columns for escalation (staff portal → admin review)
ALTER TABLE hitl_tasks
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_by TEXT;

COMMENT ON COLUMN hitl_tasks.escalation_reason IS 'Reason provided by staff when escalating to admin';
COMMENT ON COLUMN hitl_tasks.escalated_at IS 'When the task was escalated';
COMMENT ON COLUMN hitl_tasks.escalated_by IS 'Staff member who escalated (name or id)';
