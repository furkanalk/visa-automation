-- Migration: 020_agents_unique_name_per_tenant
-- Enforce one agent per (tenant_id, name). Updates via PATCH; POST returns 409 if name exists.

-- Remove duplicate rows: keep one per (tenant_id, name) with latest updated_at
DELETE FROM agents
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id, name ORDER BY updated_at DESC) AS rn
    FROM agents
  ) sub
  WHERE sub.rn = 1
);

-- Enforce uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_tenant_name ON agents(tenant_id, name);

COMMENT ON INDEX uq_agents_tenant_name IS 'One agent name per tenant; use PATCH to update existing agent';
