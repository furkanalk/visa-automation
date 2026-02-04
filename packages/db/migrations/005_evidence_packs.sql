-- Migration: 005_evidence_packs
-- Description: Create evidence_packs table for sealed proof of work

CREATE TABLE IF NOT EXISTS evidence_packs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  storage_path  TEXT NOT NULL,
  checksum      TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  sealed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ,
  contents      JSONB NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_evidence_packs_tenant_id ON evidence_packs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_evidence_packs_sealed_at ON evidence_packs (sealed_at DESC);

-- Comments
COMMENT ON TABLE evidence_packs IS 'Sealed proof of completed visa application work';
COMMENT ON COLUMN evidence_packs.storage_path IS 'Path to the evidence pack file in storage';
COMMENT ON COLUMN evidence_packs.checksum IS 'SHA-256 hash for integrity verification';
COMMENT ON COLUMN evidence_packs.contents IS 'Metadata about pack contents (screenshot list, timeline, etc.)';
