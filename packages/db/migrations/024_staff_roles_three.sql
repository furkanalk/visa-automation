-- Staff roles: exactly 3 roles — super_admin, admin, staff
-- Migrate existing senior_staff and supervisor to staff, then restrict role check.

UPDATE staff_members SET role = 'staff' WHERE role IN ('senior_staff', 'supervisor');

ALTER TABLE staff_members DROP CONSTRAINT IF EXISTS staff_members_role_check;
ALTER TABLE staff_members ADD CONSTRAINT staff_members_role_check
  CHECK (role IN ('staff', 'admin', 'super_admin'));
