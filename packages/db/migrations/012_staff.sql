-- Migration: Staff Management Tables
-- Creates tables for managing staff members and tracking their activity

-- =============================================
-- Staff Members Table
-- =============================================
CREATE TABLE IF NOT EXISTS staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Authentication
  email TEXT NOT NULL,
  password_hash TEXT, -- NULL if using SSO
  
  -- Profile
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'senior_staff', 'supervisor', 'admin')),
  avatar_url TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  
  -- Capabilities/Permissions
  permissions JSONB NOT NULL DEFAULT '[]',
  -- e.g., ["captcha", "otp", "document_review", "manual_booking"]
  
  -- Settings
  settings JSONB NOT NULL DEFAULT '{}',
  -- e.g., {"max_concurrent_tasks": 3, "notification_sound": true}
  
  -- Performance metrics (cached, updated periodically)
  metrics JSONB NOT NULL DEFAULT '{}',
  -- e.g., {"total_tasks": 0, "resolved_tasks": 0, "avg_resolution_time_ms": 0}
  
  -- Timestamps
  last_active_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT uq_staff_email_tenant UNIQUE (tenant_id, email)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_staff_tenant ON staff_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff_members(status);
CREATE INDEX IF NOT EXISTS idx_staff_role ON staff_members(role);
CREATE INDEX IF NOT EXISTS idx_staff_last_active ON staff_members(last_active_at);

-- Updated at trigger (PostgreSQL has no CREATE OR REPLACE for triggers)
DROP TRIGGER IF EXISTS update_staff_members_updated_at ON staff_members;
CREATE TRIGGER update_staff_members_updated_at
  BEFORE UPDATE ON staff_members
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- Staff Activity Log Table
-- =============================================
CREATE TABLE IF NOT EXISTS staff_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  
  -- Activity details
  action TEXT NOT NULL,
  -- e.g., 'task_assigned', 'task_resolved', 'task_escalated', 'login', 'logout'
  
  resource_type TEXT,
  -- e.g., 'hitl_task', 'customer', 'job'
  
  resource_id UUID,
  
  -- Additional context
  details JSONB NOT NULL DEFAULT '{}',
  -- e.g., {"task_type": "CAPTCHA", "resolution_time_ms": 15000}
  
  -- Client info
  ip_address INET,
  user_agent TEXT,
  
  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_staff_activity_tenant ON staff_activity_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_staff_activity_staff ON staff_activity_log(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_activity_action ON staff_activity_log(action);
CREATE INDEX IF NOT EXISTS idx_staff_activity_created ON staff_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_activity_resource ON staff_activity_log(resource_type, resource_id);

-- =============================================
-- Staff Sessions Table (for tracking online status)
-- =============================================
CREATE TABLE IF NOT EXISTS staff_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  
  -- Session info
  token_hash TEXT NOT NULL UNIQUE,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'busy', 'offline')),
  
  -- Device/client info
  device_info JSONB NOT NULL DEFAULT '{}',
  
  -- Timestamps
  last_heartbeat_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_staff_sessions_staff ON staff_sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_status ON staff_sessions(status);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_heartbeat ON staff_sessions(last_heartbeat_at);

-- =============================================
-- HITL tasks: staff assignment/resolution (for future staff portal – assign/resolve from portal)
-- =============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hitl_tasks' AND column_name = 'assigned_staff_id'
  ) THEN
    ALTER TABLE hitl_tasks ADD COLUMN assigned_staff_id UUID REFERENCES staff_members(id) ON DELETE SET NULL;
    CREATE INDEX idx_hitl_assigned_staff ON hitl_tasks(assigned_staff_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'hitl_tasks' AND column_name = 'resolved_staff_id'
  ) THEN
    ALTER TABLE hitl_tasks ADD COLUMN resolved_staff_id UUID REFERENCES staff_members(id) ON DELETE SET NULL;
    CREATE INDEX idx_hitl_resolved_staff ON hitl_tasks(resolved_staff_id);
  END IF;
END $$;

-- =============================================
-- Insert default admin staff member
-- =============================================
-- This creates a default admin for development/testing
INSERT INTO staff_members (tenant_id, email, name, role, status, permissions)
SELECT 
  id,
  'admin@visa-automation.local',
  'System Admin',
  'admin',
  'active',
  '["captcha", "otp", "document_review", "manual_booking", "escalation", "admin"]'::jsonb
FROM tenants
ON CONFLICT (tenant_id, email) DO NOTHING;

-- Sample staff members for development
INSERT INTO staff_members (tenant_id, email, name, role, status, permissions)
SELECT 
  id,
  'staff1@visa-automation.local',
  'Staff User 1',
  'staff',
  'active',
  '["captcha", "otp"]'::jsonb
FROM tenants
ON CONFLICT (tenant_id, email) DO NOTHING;

INSERT INTO staff_members (tenant_id, email, name, role, status, permissions)
SELECT 
  id,
  'staff2@visa-automation.local',
  'Staff User 2',
  'senior_staff',
  'active',
  '["captcha", "otp", "document_review"]'::jsonb
FROM tenants
ON CONFLICT (tenant_id, email) DO NOTHING;
