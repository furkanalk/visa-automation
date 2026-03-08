-- Migration: 046_notify_routing
-- Description: Add notify_routing JSONB column and booking_send_to_customer flag to notify_settings

ALTER TABLE notify_settings
  ADD COLUMN IF NOT EXISTS notify_routing JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE notify_settings
  ADD COLUMN IF NOT EXISTS booking_send_to_customer BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN notify_settings.notify_routing IS 'Per-event routing: { slot_open, booking, agent_start, agent_done, agent_fail, hitl } -> { telegram, email }';
COMMENT ON COLUMN notify_settings.booking_send_to_customer IS 'When true, send a customer-friendly booking confirmation email to the applicant email address';
