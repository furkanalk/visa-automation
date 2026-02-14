-- Migration: 014_notify_dedupe
-- Description: DB-backed dedupe for notifications (job_id + type + semantic_key)

CREATE TABLE IF NOT EXISTS notify_dedupe (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id     UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  semantic_key TEXT NOT NULL DEFAULT '',
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, type, semantic_key)
);

CREATE INDEX IF NOT EXISTS idx_notify_dedupe_job_type ON notify_dedupe (job_id, type);

COMMENT ON TABLE notify_dedupe IS 'Dedupe: at most one send per (job_id, type, semantic_key). Source of truth before sending Telegram/email.';
