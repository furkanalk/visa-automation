-- Migration: 001_tenants
-- Description: Create tenants table for multi-tenant support

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE tenant_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  config        JSONB NOT NULL DEFAULT '{
    "max_concurrent_jobs": 5,
    "default_priority": 50,
    "notification_channels": ["EMAIL"],
    "hitl_timeout_minutes": 30
  }'::jsonb,
  status        tenant_status NOT NULL DEFAULT 'ACTIVE',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants (status);

-- Comments
COMMENT ON TABLE tenants IS 'Customer organizations using the visa automation platform';
COMMENT ON COLUMN tenants.slug IS 'URL-friendly unique identifier';
COMMENT ON COLUMN tenants.config IS 'Tenant-specific configuration as JSON';
