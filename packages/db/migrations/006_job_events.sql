-- Migration: 006_job_events
-- Description: Create partition-ready job_events table for audit logging

-- Create the parent table with partitioning by range on created_at
CREATE TABLE IF NOT EXISTS job_events (
  id            BIGSERIAL,
  job_id        UUID NOT NULL,
  tenant_id     UUID NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create initial partitions for 2026
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS job_events_2026_01 PARTITION OF job_events
    FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00');
  CREATE TABLE IF NOT EXISTS job_events_2026_02 PARTITION OF job_events
    FOR VALUES FROM ('2026-02-01 00:00:00+00') TO ('2026-03-01 00:00:00+00');
  CREATE TABLE IF NOT EXISTS job_events_2026_03 PARTITION OF job_events
    FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');
  CREATE TABLE IF NOT EXISTS job_events_2026_04 PARTITION OF job_events
    FOR VALUES FROM ('2026-04-01 00:00:00+00') TO ('2026-05-01 00:00:00+00');
  CREATE TABLE IF NOT EXISTS job_events_2026_05 PARTITION OF job_events
    FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-06-01 00:00:00+00');
  CREATE TABLE IF NOT EXISTS job_events_2026_06 PARTITION OF job_events
    FOR VALUES FROM ('2026-06-01 00:00:00+00') TO ('2026-07-01 00:00:00+00');
END $$;

-- Create indexes on each partition (guard ile)
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_01_job_id ON job_events_2026_01 (job_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_01_tenant_id ON job_events_2026_01 (tenant_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_02_job_id ON job_events_2026_02 (job_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_02_tenant_id ON job_events_2026_02 (tenant_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_03_job_id ON job_events_2026_03 (job_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_03_tenant_id ON job_events_2026_03 (tenant_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_04_job_id ON job_events_2026_04 (job_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_04_tenant_id ON job_events_2026_04 (tenant_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_05_job_id ON job_events_2026_05 (job_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_05_tenant_id ON job_events_2026_05 (tenant_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_06_job_id ON job_events_2026_06 (job_id);
  CREATE INDEX IF NOT EXISTS idx_job_events_2026_06_tenant_id ON job_events_2026_06 (tenant_id);
END $$;

-- Function to automatically create future partitions
CREATE OR REPLACE FUNCTION create_job_events_partition(
  p_year INTEGER,
  p_month INTEGER
) RETURNS TEXT AS $$
DECLARE
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
BEGIN
  partition_name := format('job_events_%s_%s', 
    p_year, 
    lpad(p_month::TEXT, 2, '0'));
  
  start_date := make_date(p_year, p_month, 1);
  end_date := start_date + INTERVAL '1 month';
  
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF job_events 
     FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    start_date,
    end_date
  );
  
  -- Create indexes on the new partition
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (job_id)',
    partition_name || '_job_id_idx',
    partition_name
  );
  
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)',
    partition_name || '_tenant_id_idx',
    partition_name
  );
  
  RETURN partition_name;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE job_events IS 'Append-only audit log of job events, partitioned by month';
COMMENT ON COLUMN job_events.event_type IS 'Type of event (STATE_TRANSITION, CHECKPOINT_SAVED, etc.)';
COMMENT ON COLUMN job_events.payload IS 'Event-specific data as JSON';
