-- Migration 011: Customers and Customer Secrets
-- Customer profiles are the source of jobs in production

-- Main customers table
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Display info
  display_name TEXT NOT NULL,
  internal_ref TEXT, -- Internal reference number
  tags TEXT[] DEFAULT '{}', -- Tags for grouping/filtering
  
  -- Portal assignment
  portal_id TEXT NOT NULL,
  profile_id UUID REFERENCES agent_profiles(id) ON DELETE SET NULL,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority >= 1 AND priority <= 100),
  
  -- Contact info (can be redacted for staff)
  notify_email TEXT,
  notify_phone TEXT,
  notify_telegram_chat_id TEXT,
  
  -- Preferences (visa application details)
  preferences JSONB NOT NULL DEFAULT '{}',
  -- Expected structure:
  -- {
  --   "visa_type": "tourist",
  --   "appointment_city": "istanbul", 
  --   "preferred_dates": { "from": "2024-06-01", "to": "2024-08-31" },
  --   "family_size": 1,
  --   "special_requirements": []
  -- }
  
  -- Special flags
  flags JSONB NOT NULL DEFAULT '{}',
  -- Expected structure:
  -- {
  --   "has_previous_refusal": false,
  --   "requires_otp_staff": false,
  --   "needs_family_booking": false,
  --   "has_travel_soon": false,
  --   "vip": false
  -- }
  
  -- Slot check policy
  slot_check_policy JSONB NOT NULL DEFAULT '{}',
  -- Expected structure:
  -- {
  --   "active_hours": { "start": 8, "end": 22 },
  --   "jitter_minutes": 15,
  --   "max_checks_per_day": 48,
  --   "cooldown_after_found_hours": 24,
  --   "check_interval_minutes": 30
  -- }
  
  -- Stats
  total_jobs INTEGER NOT NULL DEFAULT 0,
  successful_bookings INTEGER NOT NULL DEFAULT 0,
  last_job_at TIMESTAMP WITH TIME ZONE,
  last_slot_found_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_by TEXT
);

-- Indexes
CREATE INDEX idx_customers_tenant ON customers(tenant_id);
CREATE INDEX idx_customers_status ON customers(status);
CREATE INDEX idx_customers_portal ON customers(portal_id);
CREATE INDEX idx_customers_tenant_status ON customers(tenant_id, status);
CREATE INDEX idx_customers_tags ON customers USING GIN(tags);
CREATE INDEX idx_customers_priority ON customers(priority DESC);

-- Customer secrets table (separate for security, encrypted at rest recommended)
CREATE TABLE IF NOT EXISTS customer_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  
  -- Identity documents (should be encrypted at app level for production)
  passport_no TEXT,
  id_no TEXT, -- National ID
  birth_date DATE,
  
  -- Additional identity fields
  full_name TEXT,
  nationality TEXT,
  
  -- Portal credentials (if needed)
  portal_username TEXT,
  portal_password TEXT, -- Should be encrypted!
  
  -- Extra fields as JSON
  extra_fields JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_secrets_customer ON customer_secrets(customer_id);

-- Trigger for updated_at on customers
CREATE OR REPLACE FUNCTION update_customers_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customers_updated
  BEFORE UPDATE ON customers
  FOR EACH ROW
  EXECUTE FUNCTION update_customers_timestamp();

-- Trigger for updated_at on customer_secrets
CREATE TRIGGER trg_customer_secrets_updated
  BEFORE UPDATE ON customer_secrets
  FOR EACH ROW
  EXECUTE FUNCTION update_customers_timestamp();

-- Function to increment job count
CREATE OR REPLACE FUNCTION increment_customer_job_count()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE customers 
    SET total_jobs = total_jobs + 1,
        last_job_at = now()
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add customer_id to jobs table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'jobs' AND column_name = 'customer_id'
  ) THEN
    ALTER TABLE jobs ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
    CREATE INDEX idx_jobs_customer ON jobs(customer_id);
  END IF;
END $$;

-- Trigger to increment customer job count on job creation
DROP TRIGGER IF EXISTS trg_job_customer_count ON jobs;
CREATE TRIGGER trg_job_customer_count
  AFTER INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION increment_customer_job_count();

COMMENT ON TABLE customers IS 'Customer profiles - source of automation jobs';
COMMENT ON TABLE customer_secrets IS 'Sensitive customer identity data (should be encrypted)';
COMMENT ON COLUMN customers.preferences IS 'Visa application preferences as JSON';
COMMENT ON COLUMN customers.flags IS 'Special handling flags as JSON';
COMMENT ON COLUMN customers.slot_check_policy IS 'Scheduling policy for slot checks';
