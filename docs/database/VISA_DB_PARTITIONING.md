## Scope Labels

This document defines **PostgreSQL partitioning for job_events growth management**.

- **[OPS]** → operational/maintenance guidance
- **[MVP REQUIRED]** → only the minimal setup required to prevent insert failures
- **[PHASED / LATER]** → migration or advanced optimization

Partitioning is **transparent to application logic**. Treat this as a DB operations handbook.

---

# PostgreSQL Partitioning Guide for job_events

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Database Schema](../database/VISA_DATABASE_SCHEMA.md) | [Archival Guide](../database/VISA_JOB_EVENTS_ARCHIVAL.md) | [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md)

---

## Table of Contents

1. [Purpose](#purpose)
2. [When to Enable Partitioning](#when-to-enable-partitioning)
3. [Partitioning Model](#partitioning-model)
4. [Implementation](#implementation)
   - [Base Table Setup](#base-table-setup)
   - [Creating Monthly Partitions](#creating-monthly-partitions)
   - [Index Strategy](#index-strategy)
5. [Partition Management](#partition-management)
   - [Creating Future Partitions](#creating-future-partitions)
   - [Dropping Old Partitions](#dropping-old-partitions)
6. [Migration from Non-Partitioned Table](#migration-from-non-partitioned-table)
7. [Operational Notes](#operational-notes)

---

## Purpose

> **Scope:** [OPS]

This document defines the **exact SQL strategy** for managing growth of the append-only `job_events` table.

### Why Partitioning is Necessary

The `job_events` table grows continuously as an append-only audit log:

| Time Period | Rows (Estimated) | Notes |
|-------------|------------------|-------|
| Per day | ~50,000 | 1,000 jobs × 50 events/job |
| Per month | ~1.5 million | 50,000 × 30 days |
| Per year | ~18 million | 1.5M × 12 months |

Without partitioning, this growth causes:
- Slower query performance on recent data
- Longer VACUUM/ANALYZE operations
- Difficult data lifecycle management
- Complex archival processes

### Benefits of Partitioning

| Benefit | Description |
|---------|-------------|
| **Query Performance** | PostgreSQL prunes irrelevant partitions automatically |
| **Maintenance Efficiency** | VACUUM/ANALYZE operates per-partition |
| **Easy Archival** | Drop entire partitions instead of DELETE operations |
| **Index Flexibility** | Index only hot (recent) partitions |
| **Parallel Operations** | Concurrent operations on different partitions |

---

## When to Enable Partitioning

> **Scope:** [OPS]

Partitioning should be enabled when ANY of the following conditions are met:

| Condition | Threshold | How to Check |
|-----------|-----------|--------------|
| **Table size** | > ~5 million rows | `SELECT COUNT(*) FROM job_events;` |
| **VACUUM duration** | Noticeably increasing | Check `pg_stat_user_tables.last_vacuum` timing |
| **Query latency** | Degraded on recent events | Monitor p95 query times |
| **Table size on disk** | > 1 GB | `SELECT pg_size_pretty(pg_relation_size('job_events'));` |

### Monitoring Queries

Check current table size:
```sql
SELECT 
  schemaname,
  relname,
  n_live_tup as row_count,
  pg_size_pretty(pg_relation_size(relid)) as table_size,
  pg_size_pretty(pg_indexes_size(relid)) as index_size
FROM pg_stat_user_tables 
WHERE relname = 'job_events';
```

Check VACUUM statistics:
```sql
SELECT 
  relname,
  last_vacuum,
  last_autovacuum,
  vacuum_count,
  autovacuum_count
FROM pg_stat_user_tables 
WHERE relname = 'job_events';
```

---

## Partitioning Model

> **Scope:** [OPS]

### Partitioning Strategy

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| **Type** | RANGE partitioning | Time-series data with clear boundaries |
| **Partition Key** | `created_at` (TIMESTAMPTZ) | Natural ordering, matches query patterns |
| **Partition Interval** | Monthly | Balance between partition count and manageability |
| **Naming Convention** | `job_events_YYYY_MM` | Clear, sortable, predictable |

### Partition Layout Example

```
job_events (parent table - no data stored directly)
├── job_events_2025_10  (Oct 2025 - archived/dropped)
├── job_events_2025_11  (Nov 2025 - archived/dropped)
├── job_events_2025_12  (Dec 2025 - cold, pending archive)
├── job_events_2026_01  (Jan 2026 - hot, fully indexed)  ◀── Current
├── job_events_2026_02  (Feb 2026 - pre-created, empty)
└── job_events_2026_03  (Mar 2026 - pre-created, empty)
```

---

## Implementation

> **Scope:** [MVP REQUIRED]

### Base Table Setup

Create the partitioned parent table:

```sql
-- Drop existing table if migrating (see migration section below)
-- CREATE TABLE job_events ...

CREATE TABLE job_events (
  id            BIGSERIAL,
  job_id        UUID NOT NULL,
  tenant_id     UUID NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Composite primary key required for partitioning
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Add comments for documentation
COMMENT ON TABLE job_events IS 'Append-only audit log of job state changes and events. Partitioned by month.';
COMMENT ON COLUMN job_events.id IS 'Auto-incrementing event ID';
COMMENT ON COLUMN job_events.job_id IS 'Reference to the job this event belongs to';
COMMENT ON COLUMN job_events.tenant_id IS 'Denormalized tenant ID for fast filtering';
COMMENT ON COLUMN job_events.event_type IS 'Type of event (e.g., STATE_TRANSITION, CHECKPOINT_SAVED)';
COMMENT ON COLUMN job_events.payload IS 'Event-specific JSON data';
COMMENT ON COLUMN job_events.created_at IS 'Partition key - when the event occurred';
```

### Creating Monthly Partitions

Create partitions for each month. The `FOR VALUES FROM ... TO` clause is inclusive on the start and exclusive on the end.

```sql
-- January 2026
CREATE TABLE job_events_2026_01
PARTITION OF job_events
FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2026-02-01 00:00:00+00');

-- February 2026
CREATE TABLE job_events_2026_02
PARTITION OF job_events
FOR VALUES FROM ('2026-02-01 00:00:00+00') TO ('2026-03-01 00:00:00+00');

-- March 2026
CREATE TABLE job_events_2026_03
PARTITION OF job_events
FOR VALUES FROM ('2026-03-01 00:00:00+00') TO ('2026-04-01 00:00:00+00');

-- Continue for additional months as needed...
```

### Partition Creation Script

Automated script for creating partitions:

```sql
-- Function to create a monthly partition
CREATE OR REPLACE FUNCTION create_job_events_partition(
  p_year INTEGER,
  p_month INTEGER
) RETURNS TEXT AS $$
DECLARE
  partition_name TEXT;
  start_date DATE;
  end_date DATE;
BEGIN
  -- Generate partition name: job_events_YYYY_MM
  partition_name := format('job_events_%s_%s', 
    p_year, 
    lpad(p_month::TEXT, 2, '0'));
  
  -- Calculate date range
  start_date := make_date(p_year, p_month, 1);
  end_date := start_date + INTERVAL '1 month';
  
  -- Create partition
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF job_events 
     FOR VALUES FROM (%L) TO (%L)',
    partition_name,
    start_date,
    end_date
  );
  
  RETURN partition_name;
END;
$$ LANGUAGE plpgsql;

-- Example: Create partitions for all of 2026
DO $$
BEGIN
  FOR month IN 1..12 LOOP
    PERFORM create_job_events_partition(2026, month);
  END LOOP;
END $$;
```

### Index Strategy

**Principle:** Index only active (hot) partitions. Remove or minimize indexes on cold partitions before archival.

#### Creating Indexes on a Partition

```sql
-- For the current month's partition (e.g., January 2026)
-- These indexes support common query patterns

-- Index for job history lookups
CREATE INDEX idx_job_events_2026_01_job_id 
ON job_events_2026_01 (job_id);

-- Index for tenant filtering
CREATE INDEX idx_job_events_2026_01_tenant_id 
ON job_events_2026_01 (tenant_id);

-- Index for event type filtering (if needed)
CREATE INDEX idx_job_events_2026_01_event_type 
ON job_events_2026_01 (event_type);

-- Composite index for tenant + time range queries
CREATE INDEX idx_job_events_2026_01_tenant_time 
ON job_events_2026_01 (tenant_id, created_at DESC);
```

#### Index Creation Script

```sql
-- Function to create standard indexes on a partition
CREATE OR REPLACE FUNCTION create_job_events_indexes(
  p_partition_name TEXT
) RETURNS VOID AS $$
BEGIN
  -- Job ID index
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (job_id)',
    p_partition_name || '_job_id_idx',
    p_partition_name
  );
  
  -- Tenant ID index
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)',
    p_partition_name || '_tenant_id_idx',
    p_partition_name
  );
  
  -- Event type index
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (event_type)',
    p_partition_name || '_event_type_idx',
    p_partition_name
  );
END;
$$ LANGUAGE plpgsql;

-- Example: Create indexes on January 2026 partition
SELECT create_job_events_indexes('job_events_2026_01');
```

---

## Partition Management

> **Scope:** [MVP REQUIRED]

### Creating Future Partitions

**Best Practice:** Always have at least 2-3 months of future partitions pre-created to avoid insertion failures.

#### Automated Partition Creation (Cron Job)

Run monthly (e.g., on the 1st of each month):

```bash
#!/usr/bin/env bash
# create_future_partitions.sh
# Creates partitions for the next 3 months

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-visa_automation}"
PGUSER="${PGUSER:-postgres}"

# Calculate dates for next 3 months
for i in 1 2 3; do
  YEAR=$(date -d "+$i month" +%Y)
  MONTH=$(date -d "+$i month" +%m)
  
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<EOF
    SELECT create_job_events_partition($YEAR, $MONTH::INTEGER);
    SELECT create_job_events_indexes('job_events_${YEAR}_${MONTH}');
EOF
done

echo "Created partitions for next 3 months"
```

#### Monitoring for Missing Partitions

```sql
-- Check if inserts would fail due to missing partition
SELECT 
  date_trunc('month', now() + INTERVAL '1 month') as next_month,
  EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'job_events_' || to_char(now() + INTERVAL '1 month', 'YYYY_MM')
  ) as partition_exists;
```

### Dropping Old Partitions

**Important:** Only drop partitions AFTER successful archival. See [VISA_JOB_EVENTS_ARCHIVAL.md](../database/VISA_JOB_EVENTS_ARCHIVAL.md).

```sql
-- Drop October 2025 partition (after archival is complete)
DROP TABLE job_events_2025_10;
```

**Why DROP TABLE is superior to DELETE:**

| Approach | Time | Locks | VACUUM Needed | WAL Generated |
|----------|------|-------|---------------|---------------|
| `DELETE FROM ... WHERE` | Minutes to hours | Row locks | Yes (heavy) | High |
| `DROP TABLE partition` | Milliseconds | Brief DDL lock | No | Minimal |

#### Safe Partition Drop Script

```sql
-- Function to safely drop an archived partition
CREATE OR REPLACE FUNCTION drop_archived_partition(
  p_partition_name TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  archive_exists BOOLEAN;
BEGIN
  -- Verify archival record exists
  SELECT EXISTS (
    SELECT 1 FROM system_events 
    WHERE type = 'ARCHIVED_PARTITION' 
    AND ref = p_partition_name
  ) INTO archive_exists;
  
  IF NOT archive_exists THEN
    RAISE EXCEPTION 'Partition % has not been archived. Aborting drop.', p_partition_name;
  END IF;
  
  -- Drop the partition
  EXECUTE format('DROP TABLE IF EXISTS %I', p_partition_name);
  
  -- Log the drop
  INSERT INTO system_events (type, ref, details)
  VALUES ('DROPPED_PARTITION', p_partition_name, jsonb_build_object(
    'dropped_at', now(),
    'archive_verified', true
  ));
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Example: Drop October 2025 partition
SELECT drop_archived_partition('job_events_2025_10');
```

---

## Migration from Non-Partitioned Table

> **Scope:** [PHASED / LATER]

If you have an existing non-partitioned `job_events` table, follow this migration procedure:

### Migration Steps

```sql
-- Step 1: Rename existing table
ALTER TABLE job_events RENAME TO job_events_old;

-- Step 2: Create new partitioned table
CREATE TABLE job_events (
  id            BIGSERIAL,
  job_id        UUID NOT NULL,
  tenant_id     UUID NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Step 3: Create partitions for existing data range
-- Determine date range first:
SELECT MIN(created_at), MAX(created_at) FROM job_events_old;

-- Create partitions for each month in the range
-- (Use the create_job_events_partition function)

-- Step 4: Copy data (during maintenance window)
INSERT INTO job_events (id, job_id, tenant_id, event_type, payload, created_at)
SELECT id, job_id, tenant_id, event_type, payload, created_at
FROM job_events_old;

-- Step 5: Reset sequence to continue from max ID
SELECT setval(
  'job_events_id_seq', 
  (SELECT MAX(id) FROM job_events)
);

-- Step 6: Create indexes on each partition
-- (Use create_job_events_indexes function)

-- Step 7: Verify row counts match
SELECT 
  (SELECT COUNT(*) FROM job_events_old) as old_count,
  (SELECT COUNT(*) FROM job_events) as new_count;

-- Step 8: Drop old table (after verification)
DROP TABLE job_events_old;
```

### Migration Considerations

| Consideration | Recommendation |
|---------------|----------------|
| **Downtime** | Schedule during maintenance window |
| **Data volume** | For large tables, consider batch migration |
| **Verification** | Always verify row counts before dropping old table |
| **Rollback plan** | Keep old table until migration is verified |

---

## Operational Notes

> **Scope:** [OPS]

### Key Points

1. **Partitioning is purely operational** 
   - Does not affect application logic
   - Queries work the same way (PostgreSQL handles partition routing)
   - INSERT statements don't change

2. **Always pre-create partitions**
   - Missing partition = INSERT failure
   - Create 2-3 months ahead minimum
   - Automate with cron job

3. **Index only what you need**
   - Full indexes on hot (current) partitions
   - Consider dropping indexes before archival
   - Monitor index usage with `pg_stat_user_indexes`

4. **Monitor partition sizes**
   ```sql
   SELECT 
     c.relname as partition_name,
     pg_size_pretty(pg_relation_size(c.oid)) as size,
     pg_stat_get_live_tuples(c.oid) as row_count
   FROM pg_class c
   JOIN pg_inherits i ON c.oid = i.inhrelid
   WHERE i.inhparent = 'job_events'::regclass
   ORDER BY c.relname;
   ```

5. **Partition pruning verification**
   ```sql
   -- Check that queries are using partition pruning
   EXPLAIN (ANALYZE, COSTS OFF)
   SELECT * FROM job_events 
   WHERE created_at >= '2026-01-01' 
     AND created_at < '2026-02-01';
   
   -- Should show only job_events_2026_01 being scanned
   ```

### Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Insert fails with "no partition" | Missing partition for date | Create partition for the target date range |
| Slow queries on recent data | Missing indexes | Create indexes on hot partitions |
| VACUUM takes too long | Too many rows per partition | This is expected; partition manages this |
| Partition not being pruned | Query doesn't include partition key | Ensure `created_at` is in WHERE clause |


---

## Architecture Notes

### Relationship to Worker/Agent Concurrency [OPS]
Higher agent concurrency → more job_events writes.
Monitor partition size and autovacuum closely when increasing portal parallelism.

### Canary / Change Detection Events [OPS]
Canary jobs also append events into `job_events`.
These are low priority and should not require additional indexes.

### MVP Minimum Requirement
For first production:
- parent partitioned table
- current month partition
- next 2–3 months pre-created
- basic indexes on hot partition

Everything else is optimization.

---
