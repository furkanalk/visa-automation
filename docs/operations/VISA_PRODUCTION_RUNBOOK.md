## Scope Labels

This document defines **production incident response & operational procedures (Runbook)**.

- **[MVP REQUIRED]** → critical procedures for safe production
- **[OPS]** → operational/maintenance guidance

This is a production safety document. Do not remove incident steps.

---

# Production Runbook – Emergency Scenarios

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md) | [Grafana Dashboards](../operations/VISA_GRAFANA_DASHBOARDS.md) | [Worker Lifecycle](../architecture/VISA_WORKER_LIFECYCLE.md)

---

## Table of Contents

1. [Overview](#overview)
2. [General Principles](#general-principles)
3. [Scenario 1: Queue Growing Unbounded](#scenario-1-queue-growing-unbounded)
4. [Scenario 2: Workers Crashlooping](#scenario-2-workers-crashlooping)
5. [Scenario 3: Database Disk Full](#scenario-3-database-disk-full)
6. [Scenario 4: HITL Backlog](#scenario-4-hitl-backlog)
7. [Scenario 5: Target Site Unavailable](#scenario-5-target-site-unavailable)
8. [Scenario 6: Redis Connection Lost](#scenario-6-redis-connection-lost)
9. [Scenario 7: Database Disaster Recovery (PITR)](#scenario-7-database-disaster-recovery-pitr)
   - [WAL-G Setup](#wal-g-setup-recommended)
   - [Recovery Procedures](#recovery-procedures)
   - [Monthly Restore Drills](#monthly-restore-drill-mandatory)
   - [Production Checklist](#-pre-deployment-checklist)
10. [Incident Command Reference](#incident-command-reference)

---

## Overview

This runbook provides step-by-step procedures for handling common production emergencies in the Visa Automation system. It is designed to be used at 03:00 AM by an on-call engineer who may not be deeply familiar with the system.

### When to Use This Runbook

Use this runbook when:
- You receive a critical alert from Grafana/PagerDuty
- The system is behaving unexpectedly
- You need to safely pause or recover the system

### Document Conventions

| Symbol | Meaning |
|--------|---------|
| ⚠️ | Warning - Be careful with this action |
| ✅ | Checkpoint - Verify before proceeding |
| 🔄 | Action that may need to be repeated |
| 📊 | Check this metric/dashboard |

---

## General Principles

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        INCIDENT RESPONSE PRINCIPLES                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. NEVER PANIC                                                                  │
│     • Take a breath before acting                                               │
│     • Read the full scenario before executing commands                          │
│     • When in doubt, prefer PAUSE over aggressive action                        │
│                                                                                  │
│  2. ALWAYS PRESERVE DATA INTEGRITY                                               │
│     • Jobs can be reprocessed; lost data cannot be recovered                    │
│     • When in doubt, pause the system rather than risk data corruption          │
│     • All state is in PostgreSQL; protect the database above all                │
│                                                                                  │
│  3. PREFER PAUSED OVER FAILED                                                    │
│     • PAUSED jobs resume automatically when workers restart                     │
│     • FAILED_TERMINAL jobs require manual intervention                          │
│     • Use DRAIN_ONLY mode to gracefully wind down                               │
│                                                                                  │
│  4. COMMUNICATE                                                                  │
│     • Update the incident channel                                               │
│     • Note what actions you're taking                                           │
│     • Escalate if you're unsure                                                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Scenario 1: Queue Growing Unbounded

### Symptoms
- 📊 Alert: `queue_depth > 100 for 10+ minutes`
- Dashboard shows queue depth increasing continuously
- Jobs not being processed

### Diagnosis Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          QUEUE BACKLOG DIAGNOSIS                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Queue depth increasing                                                          │
│       │                                                                          │
│       ▼                                                                          │
│  Check: Are workers running?                                                     │
│  📊 Grafana: Worker Health → Active Workers                                      │
│  Command: docker compose ps worker                                               │
│       │                                                                          │
│       ├─── NO workers running ──▶ Go to "Workers Crashlooping" scenario         │
│       │                                                                          │
│       ▼ YES                                                                      │
│  Check: Are workers picking up jobs?                                             │
│  📊 Grafana: Worker Health → Active Runs                                         │
│       │                                                                          │
│       ├─── Workers at 0 active runs ──▶ Check worker logs                       │
│       │                                                                          │
│       ▼ Workers are processing                                                   │
│  Check: Is target site responding?                                               │
│  📊 Grafana: Error Rates → By Type                                               │
│       │                                                                          │
│       ├─── High network errors ──▶ Go to "Target Site Unavailable" scenario     │
│       │                                                                          │
│       ▼ Target site OK                                                           │
│  Conclusion: Processing is slower than ingest rate                               │
│  Action: Enable DRAIN_ONLY mode temporarily                                      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Actions

#### Step 1: Check Worker Concurrency
```bash
# SSH to production server
ssh deploy@prod.visa.example.com

# Check worker status
cd /opt/visa-automation
docker compose ps worker

# Check worker logs for errors
docker compose logs --tail=100 worker
```

✅ **Checkpoint:** Are workers running and processing?

#### Step 2: Verify Target Site Availability
```bash
# Quick check if target site is responding
curl -I https://target-visa-site.example.com

# Check worker logs for network errors
docker compose logs worker | grep -i "timeout\|network\|refused"
```

✅ **Checkpoint:** Is the target site responding?

#### Step 3: Enable DRAIN_ONLY Mode (if needed)
```bash
# Temporarily stop accepting new jobs
# This allows workers to process the backlog

# Option A: Via API
curl -X POST http://localhost:3000/admin/incident-mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"mode": "DRAIN_ONLY"}'

# Option B: Via environment variable (requires restart)
docker compose exec api sh -c 'echo "INCIDENT_MODE=DRAIN_ONLY" >> /tmp/.env'
docker compose restart api
```

#### Step 4: Notify Operations
- Update incident channel with current status
- If queue continues to grow, escalate for capacity review

#### Step 5: Resolution
Once queue depth returns to normal:
```bash
# Disable DRAIN_ONLY mode
curl -X POST http://localhost:3000/admin/incident-mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"mode": "NORMAL"}'
```

---

## Scenario 2: Workers Crashlooping

### Symptoms
- 📊 Alert: `worker_ready == 0` for any worker
- Docker shows workers continuously restarting
- Worker logs show crashes/errors

### Diagnosis Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        WORKER CRASHLOOP DIAGNOSIS                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Workers crashlooping                                                            │
│       │                                                                          │
│       ▼                                                                          │
│  Check: What do logs show?                                                       │
│  Command: docker compose logs --tail=100 worker                                  │
│       │                                                                          │
│       ├─── OOMKilled ──▶ Memory exhaustion                                      │
│       │                  Action: Reduce WORKER_CONCURRENCY or increase limits   │
│       │                                                                          │
│       ├─── Database connection error ──▶ Check PostgreSQL                       │
│       │                  Go to: docker compose logs postgres                     │
│       │                                                                          │
│       ├─── Redis connection error ──▶ Check Redis                               │
│       │                  Go to: docker compose logs redis                        │
│       │                                                                          │
│       ├─── Playwright/Browser error ──▶ Browser configuration issue             │
│       │                  Action: Check seccomp profile, tmpfs size              │
│       │                                                                          │
│       └─── Unknown error ──▶ Escalate to engineering                            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Actions

#### Step 1: Pause New Job Intake
```bash
# Prevent new jobs from entering the system while we investigate
curl -X POST http://localhost:3000/admin/incident-mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"mode": "PAUSE_ALL"}'
```

#### Step 2: Inspect Worker Logs
```bash
# Get recent logs
docker compose logs --tail=200 worker

# Look for specific errors
docker compose logs worker | grep -i "error\|exception\|fatal\|oom"

# Check if OOM killed
docker inspect $(docker compose ps -q worker) --format='{{.State.OOMKilled}}'
```

✅ **Checkpoint:** Did you identify the root cause?

#### Step 3: Apply Fix Based on Root Cause

**If OOMKilled (memory exhaustion):**
```bash
# Reduce worker concurrency temporarily
# Edit docker-compose.yml or .env
WORKER_CONCURRENCY=1  # Down from 2 or 4

# Restart workers
docker compose up -d worker
```

**If database connection issue:**
```bash
# Check PostgreSQL status
docker compose ps postgres
docker compose logs --tail=50 postgres

# Restart PostgreSQL if needed
docker compose restart postgres

# Wait for it to be healthy
docker compose ps  # Wait for postgres to show "healthy"
```

**If Redis connection issue:**
```bash
# Check Redis status
docker compose ps redis
docker compose logs --tail=50 redis

# Restart Redis if needed
docker compose restart redis
```

#### Step 4: Restart Workers
```bash
# After fixing the underlying issue
docker compose restart worker

# Verify workers are stable
docker compose logs -f worker
# Watch for 2-3 minutes to ensure no crashes
```

#### Step 5: Resume Operations
```bash
# Re-enable normal operations
curl -X POST http://localhost:3000/admin/incident-mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"mode": "NORMAL"}'
```

---

## Scenario 3: Database Disk Full

### Symptoms
- 📊 Alert: `pg_database_size > 90%`
- PostgreSQL errors about disk space
- Inserts failing

### ⚠️ Critical Warning
This is a **data-integrity-critical** scenario. Act carefully.

### Actions

#### Step 1: Pause All Workers
```bash
# IMMEDIATELY stop all processing to prevent data corruption
curl -X POST http://localhost:3000/admin/incident-mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"mode": "PAUSE_ALL"}'

# Verify workers have stopped
docker compose logs --tail=20 worker
```

#### Step 2: Assess Disk Usage
```bash
# Check disk space
df -h

# Check PostgreSQL data directory size
du -sh /var/lib/docker/volumes/*postgres*

# Connect to PostgreSQL and check table sizes
docker compose exec postgres psql -U visa_app -d visa_automation -c "
SELECT 
  relname as table,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;"
```

✅ **Checkpoint:** Which table is consuming the most space?

#### Step 3: Free Space (Choose appropriate action)

**Option A: Archive Old Partitions (Preferred)**
```bash
# If job_events is the largest table
# Run the archival script for oldest partition
./scripts/archive_partition.sh job_events_2025_10

# Verify space freed
df -h
```

**Option B: Drop Old Partitions (If archival not possible)**
```bash
# ⚠️ Only if data has already been archived or is not needed
docker compose exec postgres psql -U visa_app -d visa_automation -c "
DROP TABLE job_events_2025_10;"
```

**Option C: Increase Disk Size (If no data can be removed)**
```bash
# This requires cloud provider console or Terraform
# Expand the EBS volume / disk
# Then resize the filesystem:
sudo resize2fs /dev/xvda1  # Adjust device name
```

#### Step 4: Verify PostgreSQL Health
```bash
# Check PostgreSQL is healthy
docker compose exec postgres psql -U visa_app -d visa_automation -c "SELECT 1;"

# Check for any corruption
docker compose exec postgres psql -U visa_app -d visa_automation -c "
SELECT datname, pg_database_size(datname) FROM pg_database;"
```

#### Step 5: Resume Operations
```bash
# Re-enable normal operations
curl -X POST http://localhost:3000/admin/incident-mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"mode": "NORMAL"}'
```

---

## Scenario 4: HITL Backlog

### Symptoms
- 📊 Alert: `hitl_pending_total > 20` or `hitl_wait_seconds p95 > SLA`
- Operators cannot keep up with HITL tasks
- Jobs stuck in WAITING_HITL state

### Actions

#### Step 1: Notify Operators
```bash
# Send notification to operator channel
# This is typically automated via Grafana alert
# Manual notification if needed:
curl -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer $SLACK_TOKEN" \
  -d "channel=#hitl-operators&text=⚠️ HITL backlog alert: X tasks pending"
```

#### Step 2: Extend SLA If Possible
```bash
# If business allows, extend expires_at for pending tasks
docker compose exec postgres psql -U visa_app -d visa_automation -c "
UPDATE hitl_tasks 
SET expires_at = expires_at + INTERVAL '30 minutes'
WHERE status = 'PENDING';"
```

⚠️ Only extend SLA if business has approved.

#### Step 3: Escalate Priority Jobs
```bash
# Identify high-priority jobs waiting for HITL
docker compose exec postgres psql -U visa_app -d visa_automation -c "
SELECT h.id, j.priority, h.created_at, h.expires_at
FROM hitl_tasks h
JOIN jobs j ON h.job_id = j.id
WHERE h.status = 'PENDING'
ORDER BY j.priority DESC, h.created_at ASC
LIMIT 20;"

# Share this list with operators for prioritization
```

#### Step 4: Consider Temporary Measures
- Request additional operator support
- If pattern continues, investigate root cause (new CAPTCHA type, etc.)

---

## Scenario 5: Target Site Unavailable

### Symptoms
- 📊 High `failed_retryable_total` with network/timeout errors
- Multiple workers failing simultaneously
- Browser automation logs show timeouts

### Actions

#### Step 1: Verify Target Site Status
```bash
# Check if target site is reachable
curl -I https://target-visa-site.example.com

# Check from worker container
docker compose exec worker curl -I https://target-visa-site.example.com
```

#### Step 2: Enable HITL_ONLY Mode
```bash
# Stop automation attempts, only process HITL tasks
curl -X POST http://localhost:3000/admin/incident-mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"mode": "HITL_ONLY"}'
```

This allows:
- HITL tasks to continue
- No new automation attempts (which would fail)
- Jobs remain in queue for when site recovers

#### Step 3: Monitor and Wait
- Set a reminder to check site status every 15-30 minutes
- Check target site's status page if available
- Jobs will automatically resume when mode is changed back

#### Step 4: Resume When Site Recovers
```bash
# Verify site is responding
curl -I https://target-visa-site.example.com

# Resume normal operations
curl -X POST http://localhost:3000/admin/incident-mode \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"mode": "NORMAL"}'
```

---

## Scenario 6: Redis Connection Lost

### Symptoms
- 📊 Worker logs show Redis connection errors
- Queue operations failing
- Lease management broken

### Actions

#### Step 1: Check Redis Status
```bash
docker compose ps redis
docker compose logs --tail=50 redis
```

#### Step 2: Attempt Redis Recovery
```bash
# If Redis container is down
docker compose restart redis

# Wait for health check
sleep 10
docker compose ps redis
```

#### Step 3: Verify Connection
```bash
# Test Redis connectivity
docker compose exec redis redis-cli ping
# Should return: PONG

# Check Redis memory
docker compose exec redis redis-cli info memory
```

#### Step 4: Restart Dependent Services
```bash
# After Redis is healthy, restart services that connect to it
docker compose restart api worker
```

#### Step 5: Verify Recovery
```bash
# Check that workers are processing
docker compose logs --tail=50 worker

# Verify API is responding
curl http://localhost:3000/health/ready
```

---

## Scenario 7: Database Disaster Recovery (PITR)

### Overview

Standard `pg_dump` backups only capture point-in-time snapshots. If the database fails at 17:00 and your last backup was at 09:00, you lose 8 hours of data.

**Point-in-Time Recovery (PITR)** using WAL (Write-Ahead Log) archiving allows recovery to any point in time.

### Recovery Objectives (SLA Commitments)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      DISASTER RECOVERY SLA TARGETS                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  RPO (Recovery Point Objective)                                                  │
│  ──────────────────────────────────────────────────────────────────────────────  │
│  Target: < 5 minutes data loss                                                   │
│  How: Continuous WAL archiving every 60 seconds                                  │
│  Acceptable: < 15 minutes (during maintenance windows)                           │
│  Unacceptable: > 30 minutes (requires incident review)                           │
│                                                                                  │
│  RTO (Recovery Time Objective)                                                   │
│  ──────────────────────────────────────────────────────────────────────────────  │
│  Target: 30 minutes from disk failure to service restored                        │
│  Breakdown:                                                                      │
│    • Detection & Incident Declaration: 5 minutes                                 │
│    • Provision new infrastructure: 10 minutes                                    │
│    • Restore base backup: 5-10 minutes                                           │
│    • Replay WAL segments: 5-15 minutes (depends on RPO)                          │
│    • Validation & DNS cutover: 5 minutes                                         │
│                                                                                  │
│  Measured RTO (from monthly drills): 38-45 minutes average                       │
│                                                                                  │
│  🎯 Business Impact:                                                             │
│     • < 30 min downtime: Customer notification not required                      │
│     • 30-60 min downtime: Email notification to active customers                 │
│     • > 60 min downtime: Service credit eligibility                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Compliance Requirements:**
- ✅ Monthly restore drills (documented evidence required)
- ✅ Automated backup verification (daily)
- ✅ Off-site backup storage (S3 in different region than production)
- ✅ Retention: 30 daily backups + 12 monthly backups (for audit compliance)

### Backup Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      PITR BACKUP ARCHITECTURE                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐            │
│  │  PostgreSQL  │────▶│  WAL-G / Barman  │────▶│  S3 Bucket       │            │
│  │              │     │  (WAL Archiver)  │     │  (Backup Storage)│            │
│  └──────────────┘     └──────────────────┘     └──────────────────┘            │
│         │                                              │                        │
│         │ Continuous WAL streaming                     │ Daily base backups     │
│         │ (every few seconds)                          │ (full snapshot)        │
│         ▼                                              ▼                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  RECOVERY CAPABILITY                                                    │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Latest base backup: Full restore point                               │    │
│  │  • WAL segments: Replay to any point since base backup                  │    │
│  │  • RPO (Recovery Point Objective): ~seconds                             │    │
│  │  • RTO (Recovery Time Objective): 15-60 minutes                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### WAL-G Setup (Recommended)

#### Step 1: Install WAL-G

```bash
# In Dockerfile for postgres container
RUN curl -L https://github.com/wal-g/wal-g/releases/download/v2.0.1/wal-g-pg-ubuntu-20.04-amd64 \
    -o /usr/local/bin/wal-g && chmod +x /usr/local/bin/wal-g
```

#### Step 2: Configure PostgreSQL for WAL Archiving

```bash
# postgresql.conf additions
archive_mode = on
archive_command = 'wal-g wal-push %p'
archive_timeout = 60  # Archive at least every 60 seconds

# For better durability
wal_level = replica
max_wal_senders = 3
```

#### Step 3: Configure WAL-G Environment

```bash
# /etc/wal-g.d/env (or Docker secrets)
export WALG_S3_PREFIX=s3://visa-automation-backups/wal-g
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=eu-central-1
export PGHOST=/var/run/postgresql
export PGUSER=postgres
```

#### Step 4: Daily Base Backup Cron

```bash
# /etc/cron.d/wal-g-backup
0 3 * * * postgres /usr/local/bin/wal-g backup-push /var/lib/postgresql/data 2>&1 | logger -t wal-g

# Retention: Keep 7 daily backups
0 4 * * * postgres /usr/local/bin/wal-g delete retain 7 --confirm 2>&1 | logger -t wal-g
```

### Recovery Procedures

#### Scenario A: Recover to Latest Point

```bash
# 1. Stop PostgreSQL
docker compose stop postgres

# 2. Clear existing data directory (DANGEROUS - ensure backups exist!)
rm -rf /var/lib/postgresql/data/*

# 3. Restore latest base backup
wal-g backup-fetch /var/lib/postgresql/data LATEST

# 4. Create recovery signal file
touch /var/lib/postgresql/data/recovery.signal

# 5. Add recovery target to postgresql.conf
echo "restore_command = 'wal-g wal-fetch %f %p'" >> /var/lib/postgresql/data/postgresql.conf
echo "recovery_target_action = 'promote'" >> /var/lib/postgresql/data/postgresql.conf

# 6. Start PostgreSQL - it will replay WAL and recover
docker compose start postgres

# 7. Verify recovery
docker compose exec postgres psql -U postgres -c "SELECT pg_is_in_recovery();"
# Should return 'f' (false) after recovery completes
```

#### Scenario B: Recover to Specific Point in Time

```bash
# Same as above, but add target time
echo "recovery_target_time = '2026-01-25 14:30:00 UTC'" >> /var/lib/postgresql/data/postgresql.conf

# This recovers to exactly 14:30:00, discarding any transactions after that
```

#### Scenario C: Recover to Specific Transaction

```bash
# If you know the transaction ID to stop at
echo "recovery_target_xid = '12345678'" >> /var/lib/postgresql/data/postgresql.conf
```

### Verification & Monitoring

#### Daily Backup Verification

```bash
# Add to monitoring cron
# Check that today's backup exists
wal-g backup-list | grep $(date +%Y-%m-%d) || alert "No backup for today!"

# Check WAL continuity
wal-g wal-verify integrity

# Verify S3 reachability
aws s3 ls s3://visa-automation-backups/wal-g/ || alert "S3 unreachable!"

# Check archive queue (should be near 0)
docker compose exec postgres psql -U postgres -c "
  SELECT archived_count, failed_count, last_archived_time, last_failed_time 
  FROM pg_stat_archiver;
"
# If failed_count is increasing, investigate immediately
```

#### Weekly Backup Validation

```bash
# Every Monday at 04:00
# Verify backup integrity without full restore
wal-g backup-list --detail | head -5

# Check total backup size trend
aws s3 ls s3://visa-automation-backups/wal-g/ --recursive --summarize \
  | grep "Total Size" \
  | tee -a /var/log/backup-size-trend.log

# Alert if size change > 50% week-over-week (potential corruption or data loss)
```

#### Monthly Restore Drill (MANDATORY)

> **⚠️ CRITICAL:** This is NOT optional. A backup you've never restored is not a backup.
> 
> **Failure to perform monthly restore drills is a compliance violation and puts business continuity at risk.**

**Schedule:** First Saturday of every month, 08:00 UTC  
**Owner:** Platform Engineer on-call  
**Duration:** ~45 minutes  
**Checklist Location:** `/ops/checklists/restore-drill-YYYY-MM.md`

##### Monthly Restore Drill Procedure

```bash
# ==============================================================================
# MONTHLY RESTORE DRILL - Run on dedicated restore-test VM
# ==============================================================================

# 1. PREPARE TEST ENVIRONMENT
# ---------------------------------------------------------------------------
export DRILL_DATE=$(date +%Y-%m-%d)
export DRILL_DIR="/mnt/restore-drill-${DRILL_DATE}"
mkdir -p ${DRILL_DIR}

# Log all actions
exec > >(tee ${DRILL_DIR}/restore-drill.log)
exec 2>&1

echo "Starting Monthly Restore Drill: ${DRILL_DATE}"
echo "Target: Restore to 7 days ago, then replay to latest"

# 2. FETCH LATEST BASE BACKUP
# ---------------------------------------------------------------------------
echo "Fetching latest base backup from S3..."
time wal-g backup-fetch ${DRILL_DIR}/pgdata LATEST

if [ $? -ne 0 ]; then
  echo "❌ DRILL FAILED: Cannot fetch base backup"
  exit 1
fi

# Verify backup timestamp
BACKUP_TIME=$(cat ${DRILL_DIR}/pgdata/backup_label | grep "START TIME" | cut -d"'" -f2)
echo "[OK] Base backup timestamp: ${BACKUP_TIME}"

# 3. VERIFY WAL AVAILABILITY
# ---------------------------------------------------------------------------
echo "Checking WAL segment availability..."
wal-g wal-show --detail | head -20

WAL_COUNT=$(wal-g wal-show | wc -l)
if [ ${WAL_COUNT} -lt 10 ]; then
  echo "WARNING: Only ${WAL_COUNT} WAL segments available"
fi

# 4. START TEST POSTGRESQL INSTANCE
# ---------------------------------------------------------------------------
echo "Starting test PostgreSQL instance..."

docker run -d \
  --name restore-drill-${DRILL_DATE} \
  -e POSTGRES_PASSWORD=test \
  -e PGDATA=/var/lib/postgresql/data \
  -v ${DRILL_DIR}/pgdata:/var/lib/postgresql/data \
  -v ${DRILL_DIR}/logs:/var/log/postgresql \
  -p 5433:5432 \
  postgres:16

# Wait for recovery to complete
echo "Waiting for recovery to complete (this may take 5-30 minutes)..."
sleep 10

for i in {1..60}; do
  RECOVERY_STATUS=$(docker exec restore-drill-${DRILL_DATE} \
    psql -U postgres -t -c "SELECT pg_is_in_recovery();" 2>/dev/null | xargs)
  
  if [ "$RECOVERY_STATUS" = "f" ]; then
    echo "[OK] Recovery completed successfully"
    break
  fi
  
  echo "  [$i/60] Still recovering... (pg_is_in_recovery = ${RECOVERY_STATUS})"
  sleep 30
done

if [ "$RECOVERY_STATUS" != "f" ]; then
  echo "❌ DRILL FAILED: Recovery did not complete within 30 minutes"
  docker logs restore-drill-${DRILL_DATE} > ${DRILL_DIR}/postgres-error.log
  exit 1
fi

# 5. DATA INTEGRITY VERIFICATION
# ---------------------------------------------------------------------------
echo "Verifying data integrity..."

# Check critical tables
docker exec restore-drill-${DRILL_DATE} psql -U postgres -c "
  SELECT 
    'jobs' AS table_name, COUNT(*) AS row_count 
  FROM jobs
  UNION ALL
  SELECT 
    'job_events', COUNT(*) 
  FROM job_events
  UNION ALL
  SELECT 
    'users', COUNT(*) 
  FROM users
  UNION ALL
  SELECT 
    'payments', COUNT(*) 
  FROM payments;
" | tee ${DRILL_DIR}/table-counts.txt

# Check for orphaned records
docker exec restore-drill-${DRILL_DATE} psql -U postgres -c "
  SELECT COUNT(*) AS orphaned_events 
  FROM job_events je 
  LEFT JOIN jobs j ON je.job_id = j.id 
  WHERE j.id IS NULL;
" | tee -a ${DRILL_DIR}/table-counts.txt

# Check latest timestamp in database
LATEST_DB_TIME=$(docker exec restore-drill-${DRILL_DATE} psql -U postgres -t -c "
  SELECT MAX(created_at) FROM job_events;
" | xargs)

echo "[OK] Latest event timestamp in restored DB: ${LATEST_DB_TIME}"

# Calculate RPO (Recovery Point Objective)
CURRENT_TIME=$(date -u +%s)
RECOVERED_TIME=$(date -u -d "${LATEST_DB_TIME}" +%s)
RPO_SECONDS=$((CURRENT_TIME - RECOVERED_TIME))
RPO_MINUTES=$((RPO_SECONDS / 60))

echo "RPO (Recovery Point Objective): ${RPO_MINUTES} minutes ago"

if [ ${RPO_MINUTES} -gt 1440 ]; then
  echo "❌ DRILL FAILED: RPO > 24 hours (${RPO_MINUTES} min) - WAL archiving not working!"
  exit 1
fi

# 6. REFERENTIAL INTEGRITY CHECK
# ---------------------------------------------------------------------------
echo "Checking foreign key constraints..."

docker exec restore-drill-${DRILL_DATE} psql -U postgres -c "
  DO \$\$
  DECLARE
    r RECORD;
  BEGIN
    FOR r IN (
      SELECT conname, conrelid::regclass AS table_name
      FROM pg_constraint
      WHERE contype = 'f'
    )
    LOOP
      RAISE NOTICE 'Checking FK: % on %', r.conname, r.table_name;
      EXECUTE format('ALTER TABLE %s VALIDATE CONSTRAINT %s', r.table_name, r.conname);
    END LOOP;
  END \$\$;
"

if [ $? -eq 0 ]; then
  echo "[OK] All foreign key constraints valid"
else
  echo "[FAIL] DRILL FAILED: Foreign key constraint violations detected"
  exit 1
fi

# 7. BUSINESS LOGIC VERIFICATION
# ---------------------------------------------------------------------------
echo "Running business logic sanity checks..."

# Check job state consistency
docker exec restore-drill-${DRILL_DATE} psql -U postgres -c "
  SELECT status, COUNT(*) 
  FROM jobs 
  GROUP BY status 
  ORDER BY COUNT(*) DESC;
" | tee ${DRILL_DIR}/job-status-distribution.txt

# Check for impossible state transitions
docker exec restore-drill-${DRILL_DATE} psql -U postgres -c "
  SELECT j.id, j.status, je.event_type, je.created_at
  FROM jobs j
  JOIN job_events je ON j.id = je.job_id
  WHERE 
    (j.status = 'COMPLETED' AND je.event_type = 'JOB_STARTED' AND je.created_at > NOW() - INTERVAL '1 day')
    OR (j.status = 'PENDING' AND je.event_type = 'JOB_COMPLETED')
  LIMIT 10;
" | tee ${DRILL_DIR}/state-anomalies.txt

# 8. PERFORMANCE BASELINE
# ---------------------------------------------------------------------------
echo "Checking performance metrics..."

docker exec restore-drill-${DRILL_DATE} psql -U postgres -c "
  SELECT 
    schemaname, 
    tablename, 
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
  LIMIT 10;
" | tee ${DRILL_DIR}/table-sizes.txt

# 9. CLEANUP
# ---------------------------------------------------------------------------
echo "Cleaning up test environment..."

docker stop restore-drill-${DRILL_DATE}
docker rm restore-drill-${DRILL_DATE}

# Keep logs but delete pgdata to save space
rm -rf ${DRILL_DIR}/pgdata

echo ""
echo "========================================="
echo "RESTORE DRILL COMPLETED SUCCESSFULLY"
echo "========================================="
echo ""
echo "Logs saved to: ${DRILL_DIR}/"
echo ""
echo "DRILL SUMMARY:"
echo "  - Base Backup Time: ${BACKUP_TIME}"
echo "  - Restored to Time: ${LATEST_DB_TIME}"
echo "  - RPO Achieved: ${RPO_MINUTES} minutes"
echo "  - Data Integrity: PASS"
echo "  - FK Constraints: PASS"
echo ""
echo "Monthly restore drill checklist:"
echo "   [x] Backup fetched from S3"
echo "   [x] PostgreSQL recovered successfully"
echo "   [x] All tables present with expected row counts"
echo "   [x] Foreign key constraints validated"
echo "   [x] RPO < 24 hours (${RPO_MINUTES} minutes)"
echo ""
echo "ACTION REQUIRED:"
echo "   1. Update restore drill tracker: /ops/restore-drill-tracker.csv"
echo "   2. Report results to #platform-ops Slack channel"
echo "   3. If drill failed, create incident ticket immediately"
```

##### Restore Drill Failure Response

If the monthly restore drill fails:

1. **Immediate Actions:**
   ```bash
   # Mark backups as UNVERIFIED in monitoring
   curl -X POST https://monitoring/api/backup-status \
     -d '{"status": "UNVERIFIED", "reason": "Restore drill failed"}'
   
   # Create P1 incident
   ./admin-cli incident:create \
     --severity P1 \
     --title "Backup Restore Drill Failed - Data Recovery at Risk" \
     --description "Monthly restore drill failed. See ${DRILL_DIR}/restore-drill.log"
   ```

2. **Escalation Path:**
   - Immediately notify: `@platform-lead` and `@dba-oncall` in Slack
   - Schedule emergency sync within 4 hours
   - Do NOT wait until next drill - investigate immediately

3. **Common Failure Modes:**
   | Failure | Root Cause | Fix |
   |---------|------------|-----|
   | `backup-fetch` fails | S3 credentials expired / bucket policy changed | Rotate credentials, verify IAM policy |
   | Recovery stuck | WAL segments missing / corrupted | Check `archive_command` logs, verify S3 object integrity |
   | FK violations | Backup captured during transaction | Verify `full_page_writes = on` in postgresql.conf |
   | RPO > 24 hours | WAL archiving paused / S3 quota exceeded | Check S3 storage limits, verify `archive_command` |

##### Restore Drill Tracker

Maintain a record of all restore drills:

```csv
# /ops/restore-drill-tracker.csv
Date,Engineer,Backup_Timestamp,RPO_Minutes,Data_Integrity,FK_Constraints,Duration_Minutes,Status,Notes
2026-01-05,alice,2026-01-05 03:00:00,15,PASS,PASS,42,SUCCESS,
2026-02-01,bob,2026-02-01 03:00:00,18,PASS,PASS,38,SUCCESS,
2026-03-01,carol,2026-03-01 03:00:00,1380,PASS,PASS,45,WARNING,"RPO > 24h due to WAL archiving pause on 2026-02-28"
```

### Continuous Archiving (WAL-G) - Production Setup Checklist

#### ✅ Pre-Deployment Checklist

- [ ] **S3 Bucket Created:** `visa-automation-backups` with versioning enabled
- [ ] **IAM Policy Configured:** Least-privilege access for WAL-G
  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "s3:PutObject",
          "s3:GetObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ],
        "Resource": [
          "arn:aws:s3:::visa-automation-backups/*",
          "arn:aws:s3:::visa-automation-backups"
        ]
      }
    ]
  }
  ```
- [ ] **WAL-G Binary Installed:** Version 2.0.1+ in PostgreSQL container
- [ ] **PostgreSQL Configuration Updated:**
  - `wal_level = replica`
  - `archive_mode = on`
  - `archive_command = 'wal-g wal-push %p'`
  - `archive_timeout = 60`
  - `full_page_writes = on` (critical for consistency)
- [ ] **Environment Variables Set:** `WALG_S3_PREFIX`, AWS credentials
- [ ] **Cron Jobs Configured:**
  - Daily base backup at 03:00 UTC
  - Daily verification at 04:00 UTC
  - Retention cleanup at 05:00 UTC
- [ ] **Monitoring Alerts Created:**
  - WAL archiving lag > 5 minutes
  - Base backup missing > 26 hours
  - S3 write failures
- [ ] **Initial Base Backup Completed:**
  ```bash
  wal-g backup-push /var/lib/postgresql/data
  wal-g backup-list  # Verify backup appears
  ```
- [ ] **First Restore Drill Scheduled:** Within 7 days of production launch

#### 🔄 Ongoing Maintenance

| Task | Frequency | Owner |
|------|-----------|-------|
| Verify daily backup completed | Daily | Automated monitoring |
| Review archive lag metrics | Daily | On-call engineer |
| Execute restore drill | Monthly | Platform engineer |
| Audit S3 storage costs | Monthly | Platform lead |
| Rotate AWS credentials | Quarterly | Security team |
| Update WAL-G version | Quarterly | Platform engineer |

### Alerting

| Alert | Condition | Severity |
|-------|-----------|----------|
| **Backup Missing** | No backup in last 26 hours | 🔴 Critical |
| **WAL Archiving Lag** | `pg_stat_archiver.last_archived_time` > 5 min ago | 🟡 Warning |
| **WAL Archiving Failed** | `pg_stat_archiver.failed_count` increased | 🔴 Critical |
| **S3 Write Failure** | `archive_command` returns non-zero | 🔴 Critical |
| **Backup Size Anomaly** | Size differs >30% from last week | 🟡 Warning |
| **Restore Drill Overdue** | Last successful drill > 35 days ago | 🔴 Critical |
| **S3 Bucket Unreachable** | Cannot list S3 objects | 🔴 Critical |

---

## Incident Command Reference

### Quick Reference Commands

| Action | Command |
|--------|---------|
| **Check all services** | `docker compose ps` |
| **View logs** | `docker compose logs --tail=100 <service>` |
| **Restart service** | `docker compose restart <service>` |
| **Enable PAUSE_ALL** | `curl -X POST localhost:3000/admin/incident-mode -d '{"mode":"PAUSE_ALL"}'` |
| **Enable DRAIN_ONLY** | `curl -X POST localhost:3000/admin/incident-mode -d '{"mode":"DRAIN_ONLY"}'` |
| **Enable HITL_ONLY** | `curl -X POST localhost:3000/admin/incident-mode -d '{"mode":"HITL_ONLY"}'` |
| **Resume NORMAL** | `curl -X POST localhost:3000/admin/incident-mode -d '{"mode":"NORMAL"}'` |
| **Check disk** | `df -h` |
| **Check memory** | `docker stats --no-stream` |
| **Check queue depth** | Check Grafana or `docker compose exec redis redis-cli LLEN visa:queue:jobs` |

### Admin CLI (Default Operations Path)

> **⚠️ CRITICAL:** Never use raw SQL for job operations. Always use the Admin CLI or API endpoints. Raw SQL bypasses audit logging and can corrupt job state.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         ADMIN CLI COMMAND REFERENCE                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  JOB OPERATIONS                                                                  │
│  ────────────────────────────────────────────────────────────────────────────── │
│                                                                                  │
│  ./admin-cli job:pause <job_id>                                                 │
│      Safely pause a running job. Worker checkpoints and releases.               │
│                                                                                  │
│  ./admin-cli job:resume <job_id>                                                │
│      Resume a PAUSED job. Re-enqueues for worker pickup.                        │
│                                                                                  │
│  ./admin-cli job:retry <job_id>                                                 │
│      Retry a FAILED_RETRYABLE job. Resets retry count if --force.               │
│                                                                                  │
│  ./admin-cli job:cancel <job_id>                                                │
│      Cancel a job. Transitions to FAILED_TERMINAL with reason.                  │
│                                                                                  │
│  ./admin-cli job:force-complete <job_id> --reason "manual override"             │
│      ⚠️ DANGEROUS: Force-complete a stuck job. Requires --reason.               │
│                                                                                  │
│  ./admin-cli job:requeue-failed --status FAILED_RETRYABLE --limit 50            │
│      Batch requeue failed jobs for retry.                                       │
│                                                                                  │
│  ────────────────────────────────────────────────────────────────────────────── │
│  SYSTEM OPERATIONS                                                               │
│  ────────────────────────────────────────────────────────────────────────────── │
│                                                                                  │
│  ./admin-cli incident:pause-all                                                 │
│      Equivalent to PAUSE_ALL mode.                                              │
│                                                                                  │
│  ./admin-cli incident:drain                                                     │
│      Equivalent to DRAIN_ONLY mode.                                             │
│                                                                                  │
│  ./admin-cli incident:resume                                                    │
│      Return to NORMAL mode.                                                     │
│                                                                                  │
│  ./admin-cli worker:list                                                        │
│      Show active workers with current job assignments.                          │
│                                                                                  │
│  ./admin-cli queue:stats                                                        │
│      Show queue depth, stuck jobs, worker health.                               │
│                                                                                  │
│  ────────────────────────────────────────────────────────────────────────────── │
│  AUDIT & DEBUGGING                                                               │
│  ────────────────────────────────────────────────────────────────────────────── │
│                                                                                  │
│  ./admin-cli job:events <job_id>                                                │
│      Show full event timeline for a job.                                        │
│                                                                                  │
│  ./admin-cli job:inspect <job_id>                                               │
│      Show full job state including current_state JSONB.                         │
│                                                                                  │
│  ./admin-cli audit:recent --hours 24                                            │
│      Show recent admin actions for audit review.                                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**CLI Implementation Location:** `scripts/admin-cli` (wraps API calls with auth)

**Example Usage:**

```bash
# Pause a stuck job
./admin-cli job:pause 550e8400-e29b-41d4-a716-446655440000

# Retry all failed jobs from today
./admin-cli job:requeue-failed --status FAILED_RETRYABLE --since "today" --limit 100

# Check what went wrong with a job
./admin-cli job:events 550e8400-e29b-41d4-a716-446655440000

# Emergency: pause everything
./admin-cli incident:pause-all
```

**Why No Raw SQL:**

| Approach | Audit Log | State Validation | Webhook Triggers | Safe |
|----------|-----------|------------------|------------------|------|
| Admin CLI | ✅ | ✅ | ✅ | ✅ |
| API curl | ✅ | ✅ | ✅ | ✅ |
| **Raw SQL** | ❌ | ❌ | ❌ | ❌ |

### Incident Modes

| Mode | Effect |
|------|--------|
| `NORMAL` | All operations running normally |
| `PAUSE_ALL` | All job processing stopped |
| `DRAIN_ONLY` | No new jobs accepted; existing jobs complete |
| `HITL_ONLY` | Only HITL tasks processed; automation paused |
| `READ_ONLY_API` | API serves reads only; writes rejected |

### Escalation Contacts

| Role | Contact | When to Escalate |
|------|---------|------------------|
| On-call Engineer | PagerDuty | Automatic for critical alerts |
| Engineering Lead | Slack @engineering-lead | When unsure of action |
| Database Admin | Slack @dba-oncall | PostgreSQL issues |
| Platform Lead | Slack @platform-lead | Infrastructure issues |


---

## Additional Scenarios (Portal Automation Specific)

### Scenario: Portal Rate Limit / IP Ban [MVP REQUIRED]

Symptoms:
- spike in 403/429
- circuit breaker triggered
- canary failures
- success rate drops suddenly

Actions:
1. Pause portal intake
2. Reduce concurrency (SERIAL or low parallel)
3. Rotate proxy pool
4. Wait cooldown (10–30 min)
5. Run canary job
6. Resume gradually

Commands (example):
- admin-cli portal:pause <portal_id>
- admin-cli portal:set-policy <portal_id> serial 1
- admin-cli portal:resume <portal_id>

Purpose:
Protect IP reputation and avoid mass bans.

---

### Post-Deploy Safety Check [OPS]

After every deployment:
- run canary job per portal
- verify queue draining
- check error rate baseline
- verify DB healthy

---
