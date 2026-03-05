-- Mark a staff member as a system/bootstrap account.
-- System accounts are hidden from the staff list in the admin portal.
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_staff_is_system ON staff_members(is_system) WHERE is_system = true;
