## Scope Labels

This document defines **database operational safety & production guards**.

- **[MVP REQUIRED]** → mandatory to safely run production
- **[OPS]** → monitoring / maintenance guidance
- **[PHASED / LATER]** → future optimizations

This is a **production safety document**. Do not remove safeguards (pooling, partitions, health checks).

---

# Database Operational Guards

## Connection Pooling, Partition Safety & Admin CLI

> **Document Status:** Operational Requirement  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Database Schema](../database/VISA_DATABASE_SCHEMA.md) | [DB Partitioning](../database/VISA_DB_PARTITIONING.md) | [Production Runbook](../operations/VISA_PRODUCTION_RUNBOOK.md)

---

## Table of Contents

1. [Connection Pooling (PgBouncer)](#1-connection-pooling-pgbouncer)
2. [Partition Safety Guards](#2-partition-safety-guards)
3. [Admin CLI (No Manual SQL)](#3-admin-cli-no-manual-sql)
4. [Database Health Monitoring](#4-database-health-monitoring)

---

## 1. Connection Pooling (PgBouncer)

### 1.1 The Problem

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    CONNECTION EXPLOSION RISK                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  WITHOUT PgBouncer:                                                              │
│                                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                        │
│  │   API       │     │  Worker 1   │     │  Worker N   │                        │
│  │  (10 conn)  │     │  (5 conn)   │     │  (5 conn)   │                        │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘                        │
│         │                   │                   │                                │
│         └───────────────────┼───────────────────┘                                │
│                             │                                                    │
│                             ▼                                                    │
│                    ┌─────────────────┐                                           │
│                    │   PostgreSQL    │                                           │
│                    │  max_conn: 100  │                                           │
│                    └─────────────────┘                                           │
│                                                                                  │
│  With 10 workers: 10 + (10 × 5) = 60 connections                                 │
│  With 20 workers: 10 + (20 × 5) = 110 connections → EXCEEDS LIMIT!              │
│                                                                                  │
│  Each PG connection uses ~5-10MB RAM.                                            │
│  100 connections = 500MB-1GB just for connection overhead.                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Solution: PgBouncer

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    WITH PgBouncer (Connection Pooling)                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                        │
│  │   API       │     │  Worker 1   │     │  Worker N   │                        │
│  │  (10 conn)  │     │  (5 conn)   │     │  (5 conn)   │                        │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘                        │
│         │                   │                   │                                │
│         └───────────────────┼───────────────────┘                                │
│                             │                                                    │
│                             ▼                                                    │
│                    ┌─────────────────┐                                           │
│                    │   PgBouncer     │  ← Lightweight (~2MB RAM)                 │
│                    │  pool_size: 20  │                                           │
│                    └────────┬────────┘                                           │
│                             │                                                    │
│                             ▼                                                    │
│                    ┌─────────────────┐                                           │
│                    │   PostgreSQL    │                                           │
│                    │  max_conn: 30   │  ← Only 20 active + buffer               │
│                    └─────────────────┘                                           │
│                                                                                  │
│  100+ app connections → 20 real PG connections                                   │
│  RAM savings: ~400-800MB                                                         │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Docker Compose Configuration

```yaml
# docker-compose.yml
services:
  pgbouncer:
    image: bitnami/pgbouncer:1.21.0
    container_name: pgbouncer
    environment:
      - POSTGRESQL_HOST=postgres
      - POSTGRESQL_PORT=5432
      - POSTGRESQL_USERNAME=visa_app
      - POSTGRESQL_PASSWORD_FILE=/run/secrets/db_password
      - POSTGRESQL_DATABASE=visa_production
      - PGBOUNCER_POOL_MODE=transaction
      - PGBOUNCER_MAX_CLIENT_CONN=200
      - PGBOUNCER_DEFAULT_POOL_SIZE=20
      - PGBOUNCER_MIN_POOL_SIZE=5
      - PGBOUNCER_RESERVE_POOL_SIZE=5
      - PGBOUNCER_RESERVE_POOL_TIMEOUT=3
      - PGBOUNCER_SERVER_IDLE_TIMEOUT=60
      - PGBOUNCER_SERVER_LIFETIME=3600
    secrets:
      - db_password
    networks:
      - backend
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "pg_isready", "-h", "localhost", "-p", "6432"]
      interval: 10s
      timeout: 5s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 64M
          cpus: '0.25'
        reservations:
          memory: 32M

  postgres:
    image: postgres:16-alpine
    # ... existing config
    environment:
      # Reduce max_connections since PgBouncer handles pooling
      - POSTGRES_MAX_CONNECTIONS=50

  api:
    environment:
      # Connect to PgBouncer, NOT directly to Postgres
      - DATABASE_URL=postgresql://visa_app:${DB_PASSWORD}@pgbouncer:6432/visa_production
    depends_on:
      - pgbouncer

  worker:
    environment:
      # Workers also connect via PgBouncer
      - DATABASE_URL=postgresql://visa_app:${DB_PASSWORD}@pgbouncer:6432/visa_production
    depends_on:
      - pgbouncer
```

### 1.4 Pool Mode Selection

| Mode | Description | Use Case |
|------|-------------|----------|
| `session` | Connection held for entire session | Long transactions, LISTEN/NOTIFY |
| `transaction` | Connection returned after each transaction | **Recommended for this system** |
| `statement` | Connection returned after each statement | Very high concurrency, no multi-statement txn |

**We use `transaction` mode** because:
- Workers have short transactions (query, update, release)
- API requests are stateless
- No long-running transactions or LISTEN/NOTIFY needed

### 1.5 Connection Limits by Component

| Component | Max Connections to PgBouncer | Notes |
|-----------|------------------------------|-------|
| API | 10-20 | Per API instance |
| Worker (each) | 2-3 | Minimal, most work is browser-bound |
| Admin CLI | 2 | For maintenance operations |
| PgBouncer → PostgreSQL | 20-25 | `default_pool_size` |

**Application-Side Configuration (Prisma):**

```typescript
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Connection pool settings (for PgBouncer compatibility)
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}
```

```typescript
// lib/db.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Limit application-side pool (PgBouncer handles the rest)
  log: ['error', 'warn'],
});

// For workers: even smaller pool
const workerPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Workers don't need many connections
  // Most time spent in browser, not DB
});
```

### 1.6 PgBouncer Monitoring

```sql
-- Connect to PgBouncer admin console
-- psql -h localhost -p 6432 -U pgbouncer pgbouncer

-- Show pool statistics
SHOW POOLS;
-- Expected output:
-- database | user | cl_active | cl_waiting | sv_active | sv_idle | maxwait
-- visa_production | visa_app | 15 | 0 | 8 | 12 | 0

-- Show client connections
SHOW CLIENTS;

-- Show server connections (to PostgreSQL)
SHOW SERVERS;

-- Key metrics to monitor:
-- cl_waiting > 0 = clients waiting for connections (bad)
-- maxwait > 1s = clients waiting too long (very bad)
-- sv_active near pool_size = pool saturated (scale up)
```

**Grafana Alert Rules:**

```yaml
# PgBouncer alerts
- alert: PgBouncerClientsWaiting
  expr: pgbouncer_pools_client_waiting > 0
  for: 1m
  labels:
    severity: warning
  annotations:
    summary: "Clients waiting for database connections"

- alert: PgBouncerPoolExhausted
  expr: pgbouncer_pools_server_active >= pgbouncer_pools_pool_size * 0.9
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Connection pool nearly exhausted"
```

---

## 2. Partition Safety Guards

### 2.1 The Risk

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PARTITION MISSING = SYSTEM DOWN                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  If partition creation cron fails:                                               │
│                                                                                  │
│  INSERT INTO job_events (job_id, event_type, created_at)                        │
│  VALUES ('...', 'JOB_CREATED', '2026-02-01 00:00:01');                           │
│                                                                                  │
│  ERROR: no partition of relation "job_events" found for row                      │
│  DETAIL: Partition key of the failing row contains (created_at) = (2026-02-01)   │
│                                                                                  │
│  RESULT: All job creation fails. System is DOWN.                                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Defense in Depth

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PARTITION SAFETY LAYERS                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  LAYER 1: Proactive Creation (Cron - Monthly)                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Create partitions 3 months ahead                                       │    │
│  │  Run on 1st of each month                                               │    │
│  │  Script: /opt/visa-automation/scripts/create_future_partitions.sh       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  LAYER 2: Verification Alert (Daily)                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Check: "Does next month's partition exist?"                            │    │
│  │  Alert if missing: P1 Critical                                          │    │
│  │  Run: Every day at 09:00 UTC                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  LAYER 3: Insert Failure Alert (Real-time)                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Monitor: "no partition found" errors in logs                           │    │
│  │  Alert: Immediate P0                                                    │    │
│  │  Action: Auto-create missing partition                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  LAYER 4: Default Partition (Failsafe)                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  CREATE TABLE job_events_default PARTITION OF job_events DEFAULT;       │    │
│  │  Catches any row that doesn't match existing partitions                 │    │
│  │  Alert if rows appear in default partition                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Partition Verification Script

```bash
#!/bin/bash
# /opt/visa-automation/scripts/verify_partitions.sh
# Run daily via cron: 0 9 * * * /opt/visa-automation/scripts/verify_partitions.sh

set -euo pipefail

DB_HOST="${DB_HOST:-pgbouncer}"
DB_PORT="${DB_PORT:-6432}"
DB_NAME="${DB_NAME:-visa_production}"
DB_USER="${DB_USER:-visa_app}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

# Calculate next month
NEXT_MONTH=$(date -d "+1 month" +%Y_%m)
NEXT_MONTH_START=$(date -d "+1 month" +%Y-%m-01)
MONTH_AFTER=$(date -d "+2 months" +%Y-%m-01)

echo "$(date) - Checking partition for ${NEXT_MONTH}"

# Check if partition exists
PARTITION_EXISTS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
  SELECT EXISTS (
    SELECT 1 FROM pg_tables 
    WHERE tablename = 'job_events_${NEXT_MONTH}'
  );
")

if [ "$PARTITION_EXISTS" = "f" ]; then
  echo "ERROR: Partition job_events_${NEXT_MONTH} DOES NOT EXIST!"
  
  # Send alert
  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -X POST "$ALERT_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{
        \"severity\": \"critical\",
        \"title\": \"Missing Database Partition\",
        \"message\": \"Partition job_events_${NEXT_MONTH} does not exist. System will fail on ${NEXT_MONTH_START}.\",
        \"action\": \"Run: create_future_partitions.sh immediately\"
      }"
  fi
  
  exit 1
fi

echo "$(date) - Partition job_events_${NEXT_MONTH} exists. OK."

# Also check if default partition has any rows (it shouldn't)
DEFAULT_ROWS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "
  SELECT COUNT(*) FROM job_events_default;
" 2>/dev/null || echo "0")

if [ "$DEFAULT_ROWS" != "0" ] && [ "$DEFAULT_ROWS" != "" ]; then
  echo "WARNING: Default partition has ${DEFAULT_ROWS} rows!"
  
  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -X POST "$ALERT_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{
        \"severity\": \"warning\",
        \"title\": \"Rows in Default Partition\",
        \"message\": \"job_events_default has ${DEFAULT_ROWS} rows. Check partition configuration.\",
        \"action\": \"Investigate and move rows to correct partition\"
      }"
  fi
fi

echo "$(date) - Partition verification complete."
```

### 2.4 Default Partition Setup

```sql
-- Create default partition as failsafe
-- This catches any rows that don't match existing partitions
CREATE TABLE IF NOT EXISTS job_events_default 
  PARTITION OF job_events DEFAULT;

-- Alert trigger when rows land in default partition
CREATE OR REPLACE FUNCTION alert_default_partition_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Log to application (will be picked up by monitoring)
  RAISE WARNING 'Row inserted into job_events_default: job_id=%, created_at=%', 
    NEW.job_id, NEW.created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_default_partition_alert
  AFTER INSERT ON job_events_default
  FOR EACH ROW
  EXECUTE FUNCTION alert_default_partition_insert();
```

### 2.5 Cron Configuration

```cron
# /etc/cron.d/visa-partitions

# Create future partitions (1st of month at 02:00 UTC)
0 2 1 * * root /opt/visa-automation/scripts/create_future_partitions.sh >> /var/log/partition-create.log 2>&1

# Verify partitions exist (daily at 09:00 UTC)
0 9 * * * root /opt/visa-automation/scripts/verify_partitions.sh >> /var/log/partition-verify.log 2>&1

# Archive old partitions (1st of month at 03:00 UTC)
0 3 1 * * root /opt/visa-automation/scripts/archive_old_partitions.sh >> /var/log/partition-archive.log 2>&1
```

---

## 3. Admin CLI (No Manual SQL)

### 3.1 The Problem with Manual SQL

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    MANUAL SQL RISKS                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  RISK 1: Human Error                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Intended: UPDATE jobs SET status = 'FAILED_TERMINAL' WHERE id = '123'; │    │
│  │  Typed:    UPDATE jobs SET status = 'FAILED_TERMINAL';                  │    │
│  │  Result:   ALL JOBS MARKED AS FAILED                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  RISK 2: No Audit Trail                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Manual SQL bypasses application audit logging.                         │    │
│  │  No record of who did what, when.                                       │    │
│  │  Compliance violation.                                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  RISK 3: State Machine Bypass                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Manual UPDATE can set invalid state transitions.                       │    │
│  │  No validation of business rules.                                       │    │
│  │  Job events not recorded.                                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  SOLUTION: Admin CLI that enforces rules and logs everything.                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Admin CLI Commands

```bash
#!/bin/bash
# /opt/visa-automation/admin-cli

# Usage: admin-cli <command> [options]
# All commands require authentication and are fully audited.

case "$1" in
  # ============ JOB OPERATIONS ============
  
  pause-job)
    # Safely pause a job with proper state transition
    # Usage: admin-cli pause-job --id <job_id> --reason "maintenance"
    curl -X POST "http://localhost:3001/admin/jobs/$2/pause" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"reason\": \"$4\", \"admin_action\": true}"
    ;;
    
  resume-job)
    # Resume a paused job
    # Usage: admin-cli resume-job --id <job_id>
    curl -X POST "http://localhost:3001/admin/jobs/$2/resume" \
      -H "Authorization: Bearer $ADMIN_TOKEN"
    ;;
    
  retry-job)
    # Retry a failed job (respects retry limits unless --force)
    # Usage: admin-cli retry-job --id <job_id> [--force]
    FORCE_FLAG=""
    if [ "$4" = "--force" ]; then
      FORCE_FLAG='"force": true,'
    fi
    curl -X POST "http://localhost:3001/admin/jobs/$2/retry" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{${FORCE_FLAG} \"admin_action\": true}"
    ;;
    
  cancel-job)
    # Cancel a job (only from allowed states)
    # Usage: admin-cli cancel-job --id <job_id> --reason "customer request"
    curl -X POST "http://localhost:3001/admin/jobs/$2/cancel" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"reason\": \"$4\", \"admin_action\": true}"
    ;;
    
  mark-terminal)
    # Force a job to terminal state (EMERGENCY ONLY)
    # Usage: admin-cli mark-terminal --id <job_id> --reason "stuck in invalid state"
    echo "WARNING: This bypasses normal state machine. Confirm? (yes/no)"
    read CONFIRM
    if [ "$CONFIRM" = "yes" ]; then
      curl -X POST "http://localhost:3001/admin/jobs/$2/force-transition" \
        -H "Authorization: Bearer $ADMIN_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"target_state\": \"FAILED_TERMINAL\", \"reason\": \"$4\", \"bypass_fsm\": true}"
    fi
    ;;

  # ============ BULK OPERATIONS ============
  
  pause-all)
    # Pause all queued jobs (incident mode)
    # Usage: admin-cli pause-all --reason "scheduled maintenance"
    curl -X POST "http://localhost:3001/admin/incident-mode" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"mode\": \"PAUSE_ALL\", \"reason\": \"$3\"}"
    ;;
    
  resume-all)
    # Resume normal operations
    # Usage: admin-cli resume-all
    curl -X POST "http://localhost:3001/admin/incident-mode" \
      -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"mode\": \"NORMAL\"}"
    ;;
    
  requeue-stuck)
    # Requeue all stuck jobs (no heartbeat for >5min)
    # Usage: admin-cli requeue-stuck
    curl -X POST "http://localhost:3001/admin/jobs/requeue-stuck" \
      -H "Authorization: Bearer $ADMIN_TOKEN"
    ;;

  # ============ WORKER OPERATIONS ============
  
  drain-worker)
    # Gracefully drain a worker
    # Usage: admin-cli drain-worker --id <worker_id>
    curl -X POST "http://localhost:3001/admin/workers/$2/drain" \
      -H "Authorization: Bearer $ADMIN_TOKEN"
    ;;
    
  list-workers)
    # List all workers and their status
    # Usage: admin-cli list-workers
    curl -s "http://localhost:3001/admin/workers" \
      -H "Authorization: Bearer $ADMIN_TOKEN" | jq
    ;;

  # ============ HITL OPERATIONS ============
  
  expire-hitl)
    # Force expire a HITL task
    # Usage: admin-cli expire-hitl --id <task_id>
    curl -X POST "http://localhost:3001/admin/hitl/$2/expire" \
      -H "Authorization: Bearer $ADMIN_TOKEN"
    ;;

  # ============ DIAGNOSTIC ============
  
  job-status)
    # Get full job status and history
    # Usage: admin-cli job-status --id <job_id>
    curl -s "http://localhost:3001/admin/jobs/$2/full" \
      -H "Authorization: Bearer $ADMIN_TOKEN" | jq
    ;;
    
  queue-stats)
    # Get queue statistics
    # Usage: admin-cli queue-stats
    curl -s "http://localhost:3001/admin/stats/queue" \
      -H "Authorization: Bearer $ADMIN_TOKEN" | jq
    ;;

  *)
    echo "Unknown command: $1"
    echo "Usage: admin-cli <command> [options]"
    echo ""
    echo "Job Operations:"
    echo "  pause-job --id <id> --reason <reason>"
    echo "  resume-job --id <id>"
    echo "  retry-job --id <id> [--force]"
    echo "  cancel-job --id <id> --reason <reason>"
    echo "  mark-terminal --id <id> --reason <reason>  (EMERGENCY)"
    echo ""
    echo "Bulk Operations:"
    echo "  pause-all --reason <reason>"
    echo "  resume-all"
    echo "  requeue-stuck"
    echo ""
    echo "Worker Operations:"
    echo "  drain-worker --id <id>"
    echo "  list-workers"
    echo ""
    echo "Diagnostic:"
    echo "  job-status --id <id>"
    echo "  queue-stats"
    exit 1
    ;;
esac
```

### 3.3 Admin API Endpoints (Backend)

```typescript
// routes/admin.ts
import { Router } from 'express';
import { requireAdmin, auditLog } from '../middleware';

const router = Router();

// All admin routes require admin role and are audited
router.use(requireAdmin);
router.use(auditLog);

// Force state transition (emergency only)
router.post('/jobs/:id/force-transition', async (req, res) => {
  const { id } = req.params;
  const { target_state, reason, bypass_fsm } = req.body;
  
  // Log this dangerous operation
  await db.auditLog.insert({
    action: 'admin.force_transition',
    resource_type: 'job',
    resource_id: id,
    user_id: req.user.id,
    metadata: {
      target_state,
      reason,
      bypass_fsm,
      warning: 'FSM rules bypassed'
    }
  });
  
  // Perform transition
  await db.jobs.update(id, { status: target_state });
  
  // Still emit event for audit trail
  await db.jobEvents.insert({
    job_id: id,
    event_type: 'ADMIN_FORCE_TRANSITION',
    payload: { to: target_state, reason, admin_id: req.user.id }
  });
  
  res.json({ success: true, warning: 'FSM bypassed' });
});

// Requeue stuck jobs
router.post('/jobs/requeue-stuck', async (req, res) => {
  const stuckJobs = await db.query(`
    SELECT j.id FROM jobs j
    JOIN job_runs r ON r.job_id = j.id
    WHERE r.status = 'RUNNING'
      AND r.heartbeat_at < now() - interval '5 minutes'
  `);
  
  for (const job of stuckJobs) {
    await jobService.markAbandoned(job.id, 'admin_requeue');
    await jobService.requeue(job.id);
  }
  
  res.json({ 
    success: true, 
    requeued: stuckJobs.length 
  });
});
```

### 3.4 When Manual SQL is Allowed

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    MANUAL SQL: BREAK GLASS ONLY                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Manual SQL is allowed ONLY when:                                                │
│  1. Admin CLI / Admin API is unavailable (system down)                           │
│  2. Database corruption requires direct repair                                   │
│  3. Two people present (pair operation)                                          │
│                                                                                  │
│  MANDATORY STEPS:                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Document the issue in incident channel                              │    │
│  │  2. Get approval from second engineer                                   │    │
│  │  3. Start screen recording                                              │    │
│  │  4. BEGIN TRANSACTION                                                   │    │
│  │  5. Perform changes                                                     │    │
│  │  6. VERIFY results                                                      │    │
│  │  7. COMMIT (or ROLLBACK if wrong)                                       │    │
│  │  8. Manually insert audit log entry:                                    │    │
│  │                                                                         │    │
│  │     INSERT INTO audit_log (action, resource_type, metadata)             │    │
│  │     VALUES ('manual_sql', 'database', '{                                │    │
│  │       "reason": "...",                                                  │    │
│  │       "query": "...",                                                   │    │
│  │       "operator": "...",                                                │    │
│  │       "approver": "..."                                                 │    │
│  │     }');                                                                │    │
│  │                                                                         │    │
│  │  9. File incident report                                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Database Health Monitoring

### 4.1 Critical Metrics

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| Active connections | > 80% of limit | > 95% of limit | Scale pool or investigate |
| Connection wait time | > 100ms | > 1s | Increase pool size |
| Transaction duration | > 5s | > 30s | Investigate slow queries |
| Partition row count | N/A | Default partition > 0 | Fix partition config |
| Dead tuples | > 10% | > 25% | Run VACUUM |
| Disk usage | > 70% | > 85% | Archive or expand |

### 4.2 Grafana Dashboard Queries

```promql
# PgBouncer: Clients waiting
pgbouncer_pools_cl_waiting{database="visa_production"}

# PgBouncer: Pool utilization
pgbouncer_pools_sv_active{database="visa_production"} / 
pgbouncer_pools_pool_size{database="visa_production"}

# PostgreSQL: Active connections
pg_stat_activity_count{state="active"}

# PostgreSQL: Long transactions
pg_stat_activity_max_tx_duration{state="active"}

# PostgreSQL: Dead tuples ratio
pg_stat_user_tables_n_dead_tup{relname="job_events"} /
pg_stat_user_tables_n_live_tup{relname="job_events"}
```

### 4.3 Health Check Endpoint

```typescript
// /health/db endpoint
app.get('/health/db', async (req, res) => {
  try {
    // Check connection via PgBouncer
    const start = Date.now();
    await db.raw('SELECT 1');
    const latency = Date.now() - start;
    
    // Check partition exists for next month
    const nextMonth = format(addMonths(new Date(), 1), 'yyyy_MM');
    const partitionExists = await db.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = 'job_events_${nextMonth}'
      ) as exists
    `);
    
    res.json({
      status: 'healthy',
      latency_ms: latency,
      partition_ready: partitionExists.rows[0].exists,
      pool: 'pgbouncer'
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});
```


---

## Agent Concurrency Impact [OPS]

Database load scales with:
`active_agents × concurrent_jobs × queries_per_job`

Higher portal concurrency increases DB connections and query pressure.
Use **portal policies (SERIAL/PARALLEL + max_concurrency)** to prevent connection pool exhaustion.

---

## Canary / Change Detection Jobs [OPS]

Scheduled canary jobs also interact with the database:
- store DOM snapshots/diffs
- write alert events

These are operational tasks and should run via cron with low priority.

---

## CLI Additions (Agent Operations) [OPS]

Recommended operational commands:

- set-portal-policy <portal> <serial|parallel> <limit>
- assign-agent <agent_id> <portal_id>
- pause-portal <portal_id>
- resume-portal <portal_id>

These reduce manual SQL risk and improve safety.
