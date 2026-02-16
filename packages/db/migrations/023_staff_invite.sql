-- Staff invite flow: pending status and invite token for email-based registration

-- Allow 'pending' status (invited, not yet set password)
ALTER TABLE staff_members DROP CONSTRAINT IF EXISTS staff_members_status_check;
ALTER TABLE staff_members ADD CONSTRAINT staff_members_status_check
  CHECK (status IN ('active', 'inactive', 'suspended', 'pending'));

-- Invite token (secure random) and expiry for registration link
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS invite_token TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS invite_token_expires_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_invite_token ON staff_members(invite_token) WHERE invite_token IS NOT NULL;
