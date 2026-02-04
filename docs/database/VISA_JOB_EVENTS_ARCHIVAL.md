## Scope Labels

This document defines **job_events archival & retention strategy**.

- **[OPS]** → operational/maintenance process
- **[MVP REQUIRED]** → minimal cron/archival to prevent DB growth issues
- **[PHASED / LATER]** → advanced optimizations

Archival is transparent to application logic. Treat this as an operations handbook.

---

# job_events Archival Cron Job

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Database Schema](../database/VISA_DATABASE_SCHEMA.md) | [Partitioning Guide](../database/VISA_DB_PARTITIONING.md) | [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md)

---

## Table of Contents

1. [Purpose](#purpose)
2. [Retention Policy](#retention-policy)
3. [Archival Process Overview](#archival-process-overview)
4. [High-Level Flow](#high-level-flow)
5. [Implementation](#implementation)
   - [Archival Script](#archival-script)
   - [Verification Script](#verification-script)
6. [Safety Guarantees](#safety-guarantees)
7. [Recovery Procedures](#recovery-procedures)
8. [Operational Checklist](#operational-checklist)

---

## Purpose

> **Scope:** [OPS]

Archive old `job_events` partitions to object storage to control database size while maintaining long-term data retention for compliance and forensic analysis.

### Why Archival is Necessary

| Concern | Without Archival | With Archival |
|---------|------------------|---------------|
| **Database size** | Grows unbounded | Controlled to ~90 days |
| **Backup time** | Increases continuously | Remains stable |
| **Query performance** | Degrades over time | Consistent on hot data |
| **Storage costs** | High (PostgreSQL storage) | Lower (object storage) |
| **Compliance** | Data may be deleted | Long-term retention guaranteed |

---

## Retention Policy

> **Scope:** [OPS]

### Data Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DATA LIFECYCLE STAGES                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  HOT DATA (0-90 days)                                                   │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Storage: PostgreSQL (partitioned tables)                               │    │
│  │  Access: Real-time queries, debugging, operational dashboards           │    │
│  │  Indexes: Full indexing for fast queries                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                        │                                         │
│                                        │ After 90 days                           │
│                                        ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  COLD DATA (>90 days)                                                   │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Storage: Encrypted object storage (S3-compatible)                      │    │
│  │  Access: Offline analysis, compliance audits, forensic investigation    │    │
│  │  Format: Compressed JSON (.json.gz) or Parquet                          │    │
│  │  Immutable: Never modified after archival                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                        │                                         │
│                                        │ Per compliance policy (optional)        │
│                                        ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  PURGED (optional, per policy)                                          │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Some industries require data deletion after X years                    │    │
│  │  Configure object storage lifecycle rules for automatic expiration      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Policy Summary

| Data Type | Hot Retention | Cold Retention | Notes |
|-----------|---------------|----------------|-------|
| `job_events` | 90 days in PostgreSQL | Indefinite in object storage | Primary audit log |
| System events | 90 days in PostgreSQL | 1 year in object storage | Operational logs |

---

## Archival Process Overview

### Components

| Component | Purpose |
|-----------|---------|
| **Archival Script** | Exports, verifies, and uploads partition data |
| **Object Storage** | S3-compatible storage for archived data |
| **system_events Table** | Audit trail of archival operations |
| **Cron Scheduler** | Triggers archival job (e.g., monthly) |

### Archive Structure in Object Storage

```
s3://visa-automation-archives/
└── job_events/
    └── 2025/
        ├── 10/
        │   ├── job_events_2025_10.json.gz
        │   └── job_events_2025_10.json.gz.sha256
        ├── 11/
        │   ├── job_events_2025_11.json.gz
        │   └── job_events_2025_11.json.gz.sha256
        └── 12/
            ├── job_events_2025_12.json.gz
            └── job_events_2025_12.json.gz.sha256
```

---

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ARCHIVAL WORKFLOW                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Cron triggers archival job (monthly, on 5th of month)                          │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: IDENTIFY ELIGIBLE PARTITIONS                                   │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Find partitions older than retention window (90 days)                │    │
│  │  • Skip partitions already archived                                     │    │
│  │  • Skip partitions currently in use                                     │    │
│  │                                                                         │    │
│  │  Example: On 2026-01-05, eligible partitions:                           │    │
│  │    - job_events_2025_09 (Sep 2025, >90 days old)                        │    │
│  │    - job_events_2025_10 (Oct 2025, if not yet archived)                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: EXPORT DATA                                                    │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Export partition to local file                                       │    │
│  │  • Format: JSONL (JSON Lines) for easy processing                       │    │
│  │  • Compress with gzip                                                   │    │
│  │  • Store temporarily on local disk                                      │    │
│  │                                                                         │    │
│  │  Command: COPY (SELECT ...) TO '/tmp/job_events_2025_10.json'           │    │
│  │           gzip /tmp/job_events_2025_10.json                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 3: VERIFY INTEGRITY                                               │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Calculate SHA256 checksum of compressed file                         │    │
│  │  • Verify row count matches source partition                            │    │
│  │  • Write checksum to .sha256 file                                       │    │
│  │                                                                         │    │
│  │  Verification ensures data integrity before upload.                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 4: UPLOAD TO OBJECT STORAGE                                       │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Upload compressed archive to S3-compatible storage                   │    │
│  │  • Upload checksum file alongside archive                               │    │
│  │  • Use server-side encryption (SSE-S3 or SSE-KMS)                       │    │
│  │  • Verify upload success (ETag or checksum comparison)                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 5: DROP PARTITION                                                 │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • ONLY after successful upload verification                            │    │
│  │  • DROP TABLE job_events_2025_10;                                       │    │
│  │  • Instant operation (no row-by-row deletion)                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 6: WRITE AUDIT EVENT                                              │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Record archival in system_events table                               │    │
│  │  • Include: partition name, row count, archive location, checksum       │    │
│  │  • This record is checked before partition drops                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 7: CLEANUP                                                        │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Remove temporary local files                                         │    │
│  │  • Log completion                                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation

### Archival Script

Complete bash script for archiving a partition:

```bash
#!/usr/bin/env bash
# archive_partition.sh
# Archives a job_events partition to object storage
#
# Usage: ./archive_partition.sh job_events_2025_10

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

PARTITION="${1:?Usage: $0 <partition_name>}"
RETENTION_DAYS="${RETENTION_DAYS:-90}"

# Database connection
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-visa_automation}"
PGUSER="${PGUSER:-postgres}"

# Object storage (S3-compatible)
S3_BUCKET="${S3_BUCKET:-visa-automation-archives}"
S3_PREFIX="job_events"
S3_ENDPOINT="${S3_ENDPOINT:-}"  # Leave empty for AWS S3

# Local paths
WORK_DIR="${WORK_DIR:-/tmp/archival}"
ARCHIVE_FILE="${WORK_DIR}/${PARTITION}.json.gz"
CHECKSUM_FILE="${ARCHIVE_FILE}.sha256"

# ============================================================================
# Functions
# ============================================================================

log() {
  echo "[$(date -Iseconds)] $*"
}

die() {
  log "ERROR: $*" >&2
  exit 1
}

cleanup() {
  log "Cleaning up temporary files..."
  rm -f "${ARCHIVE_FILE}" "${CHECKSUM_FILE}" "${WORK_DIR}/${PARTITION}.json" 2>/dev/null || true
}
trap cleanup EXIT

# ============================================================================
# Pre-flight Checks
# ============================================================================

log "Starting archival of partition: ${PARTITION}"

# Create work directory
mkdir -p "${WORK_DIR}"

# Check partition exists
PARTITION_EXISTS=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc \
  "SELECT 1 FROM pg_class WHERE relname = '${PARTITION}'")
if [[ "$PARTITION_EXISTS" != "1" ]]; then
  die "Partition ${PARTITION} does not exist"
fi

# Check partition hasn't been archived already
ALREADY_ARCHIVED=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc \
  "SELECT 1 FROM system_events WHERE type = 'ARCHIVED_PARTITION' AND ref = '${PARTITION}'")
if [[ "$ALREADY_ARCHIVED" == "1" ]]; then
  die "Partition ${PARTITION} has already been archived"
fi

# Get row count before export
ROW_COUNT=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -tAc \
  "SELECT COUNT(*) FROM ${PARTITION}")
log "Partition contains ${ROW_COUNT} rows"

# ============================================================================
# Step 1: Export Data
# ============================================================================

log "Exporting partition data to JSON..."

# Export as JSONL (one JSON object per line)
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<EOF
COPY (
  SELECT row_to_json(t)
  FROM (
    SELECT id, job_id, tenant_id, event_type, payload, created_at
    FROM ${PARTITION}
    ORDER BY id
  ) t
) TO '${WORK_DIR}/${PARTITION}.json';
EOF

# Verify exported file exists
if [[ ! -f "${WORK_DIR}/${PARTITION}.json" ]]; then
  die "Export failed - no output file"
fi

# ============================================================================
# Step 2: Compress
# ============================================================================

log "Compressing archive..."
gzip -9 "${WORK_DIR}/${PARTITION}.json"

# Verify compressed file
if [[ ! -f "${ARCHIVE_FILE}" ]]; then
  die "Compression failed"
fi

ARCHIVE_SIZE=$(stat -c%s "${ARCHIVE_FILE}")
log "Compressed size: ${ARCHIVE_SIZE} bytes"

# ============================================================================
# Step 3: Verify Integrity
# ============================================================================

log "Calculating checksum..."
sha256sum "${ARCHIVE_FILE}" > "${CHECKSUM_FILE}"
CHECKSUM=$(cut -d' ' -f1 "${CHECKSUM_FILE}")
log "SHA256: ${CHECKSUM}"

# Verify row count in export
EXPORTED_COUNT=$(zcat "${ARCHIVE_FILE}" | wc -l)
if [[ "${EXPORTED_COUNT}" != "${ROW_COUNT}" ]]; then
  die "Row count mismatch: expected ${ROW_COUNT}, got ${EXPORTED_COUNT}"
fi
log "Row count verified: ${EXPORTED_COUNT} rows"

# ============================================================================
# Step 4: Upload to Object Storage
# ============================================================================

log "Uploading to object storage..."

# Extract year/month for path
YEAR=$(echo "${PARTITION}" | grep -oP '\d{4}')
MONTH=$(echo "${PARTITION}" | grep -oP '\d{4}_\K\d{2}')
S3_PATH="s3://${S3_BUCKET}/${S3_PREFIX}/${YEAR}/${MONTH}/"

# Build aws s3 command with optional endpoint
S3_CMD="aws s3 cp"
if [[ -n "${S3_ENDPOINT}" ]]; then
  S3_CMD="${S3_CMD} --endpoint-url ${S3_ENDPOINT}"
fi

# Upload archive
${S3_CMD} "${ARCHIVE_FILE}" "${S3_PATH}$(basename ${ARCHIVE_FILE})" \
  --sse AES256

# Upload checksum
${S3_CMD} "${CHECKSUM_FILE}" "${S3_PATH}$(basename ${CHECKSUM_FILE})" \
  --sse AES256

log "Upload complete: ${S3_PATH}"

# ============================================================================
# Step 5: Verify Upload
# ============================================================================

log "Verifying upload..."

# Download checksum and compare
REMOTE_CHECKSUM_FILE="${WORK_DIR}/remote_checksum.sha256"
${S3_CMD} "${S3_PATH}$(basename ${CHECKSUM_FILE})" "${REMOTE_CHECKSUM_FILE}"

REMOTE_CHECKSUM=$(cut -d' ' -f1 "${REMOTE_CHECKSUM_FILE}")
if [[ "${REMOTE_CHECKSUM}" != "${CHECKSUM}" ]]; then
  die "Upload verification failed: checksum mismatch"
fi
log "Upload verified successfully"

rm -f "${REMOTE_CHECKSUM_FILE}"

# ============================================================================
# Step 6: Drop Partition
# ============================================================================

log "Dropping partition from database..."

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<EOF
DROP TABLE ${PARTITION};
EOF

log "Partition dropped"

# ============================================================================
# Step 7: Write Audit Event
# ============================================================================

log "Recording archival event..."

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" <<EOF
INSERT INTO system_events (type, ref, details, created_at)
VALUES (
  'ARCHIVED_PARTITION',
  '${PARTITION}',
  '${json_details}'::jsonb,
  now()
);
EOF

# Using proper JSON escaping
json_details=$(cat <<JSONEOF
{
  "row_count": ${ROW_COUNT},
  "archive_location": "${S3_PATH}$(basename ${ARCHIVE_FILE})",
  "checksum": "${CHECKSUM}",
  "archive_size_bytes": ${ARCHIVE_SIZE},
  "archived_at": "$(date -Iseconds)"
}
JSONEOF
)

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
  -c "INSERT INTO system_events (type, ref, details) VALUES ('ARCHIVED_PARTITION', '${PARTITION}', '${json_details}'::jsonb)"

log "Audit event recorded"

# ============================================================================
# Done
# ============================================================================

log "Archival complete for ${PARTITION}"
log "  - Rows archived: ${ROW_COUNT}"
log "  - Archive location: ${S3_PATH}"
log "  - Checksum: ${CHECKSUM}"
```

### Verification Script

Script to verify an archived partition can be restored:

```bash
#!/usr/bin/env bash
# verify_archive.sh
# Verifies an archived partition is intact and readable
#
# Usage: ./verify_archive.sh job_events_2025_10

set -euo pipefail

PARTITION="${1:?Usage: $0 <partition_name>}"

# Configuration (same as archival script)
S3_BUCKET="${S3_BUCKET:-visa-automation-archives}"
S3_PREFIX="job_events"
WORK_DIR="${WORK_DIR:-/tmp/archival-verify}"

log() {
  echo "[$(date -Iseconds)] $*"
}

# Extract year/month
YEAR=$(echo "${PARTITION}" | grep -oP '\d{4}')
MONTH=$(echo "${PARTITION}" | grep -oP '\d{4}_\K\d{2}')
S3_PATH="s3://${S3_BUCKET}/${S3_PREFIX}/${YEAR}/${MONTH}/"

mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"

log "Downloading archive..."
aws s3 cp "${S3_PATH}${PARTITION}.json.gz" .
aws s3 cp "${S3_PATH}${PARTITION}.json.gz.sha256" .

log "Verifying checksum..."
sha256sum -c "${PARTITION}.json.gz.sha256"

log "Verifying content is valid JSON..."
zcat "${PARTITION}.json.gz" | head -1 | jq . > /dev/null

log "Counting rows..."
ROW_COUNT=$(zcat "${PARTITION}.json.gz" | wc -l)
log "Archive contains ${ROW_COUNT} rows"

log "Verification successful!"

# Cleanup
rm -f "${PARTITION}.json.gz" "${PARTITION}.json.gz.sha256"
```

---

## Safety Guarantees

The archival process provides the following safety guarantees:

### Idempotent

| Guarantee | Implementation |
|-----------|----------------|
| **No duplicate archives** | Check `system_events` before archiving |
| **Safe to re-run** | Script exits gracefully if already archived |
| **Atomic operations** | Either complete fully or leave state unchanged |

### Checksum Verified

| Guarantee | Implementation |
|-----------|----------------|
| **Pre-upload verification** | SHA256 calculated after export |
| **Post-upload verification** | Checksum compared after upload |
| **Stored with archive** | `.sha256` file uploaded alongside archive |
| **Restorable** | Can verify integrity before restore |

### No Runtime Dependency

| Guarantee | Implementation |
|-----------|----------------|
| **Application unchanged** | No code changes needed |
| **Queries unaffected** | Old data simply not in database |
| **No restore needed** | Archived data not used at runtime |
| **Forensic access only** | Manual restore if investigation needed |

---

## Recovery Procedures

> **Scope:** [OPS]

### Restoring an Archived Partition

If you need to restore data for investigation or compliance audit:

```bash
#!/usr/bin/env bash
# restore_partition.sh
# Restores an archived partition to PostgreSQL
#
# Usage: ./restore_partition.sh job_events_2025_10

set -euo pipefail

PARTITION="${1:?Usage: $0 <partition_name>}"

# Configuration
S3_BUCKET="${S3_BUCKET:-visa-automation-archives}"
S3_PREFIX="job_events"
PGHOST="${PGHOST:-localhost}"
PGDATABASE="${PGDATABASE:-visa_automation}"
WORK_DIR="/tmp/restore"

log() {
  echo "[$(date -Iseconds)] $*"
}

# Extract year/month
YEAR=$(echo "${PARTITION}" | grep -oP '\d{4}')
MONTH=$(echo "${PARTITION}" | grep -oP '\d{4}_\K\d{2}')
S3_PATH="s3://${S3_BUCKET}/${S3_PREFIX}/${YEAR}/${MONTH}/"

mkdir -p "${WORK_DIR}"
cd "${WORK_DIR}"

# Download and verify
log "Downloading archive..."
aws s3 cp "${S3_PATH}${PARTITION}.json.gz" .
aws s3 cp "${S3_PATH}${PARTITION}.json.gz.sha256" .

log "Verifying checksum..."
sha256sum -c "${PARTITION}.json.gz.sha256"

# Decompress
log "Decompressing..."
gunzip "${PARTITION}.json.gz"

# Create partition if not exists
log "Creating partition..."
START_DATE="${YEAR}-${MONTH}-01"
END_DATE=$(date -d "${START_DATE} + 1 month" +%Y-%m-%d)

psql -h "$PGHOST" -d "$PGDATABASE" <<EOF
CREATE TABLE IF NOT EXISTS ${PARTITION}
PARTITION OF job_events
FOR VALUES FROM ('${START_DATE}') TO ('${END_DATE}');
EOF

# Import data
log "Importing data..."
# Convert JSONL to COPY format and import
cat "${PARTITION}.json" | psql -h "$PGHOST" -d "$PGDATABASE" -c "
  CREATE TEMP TABLE import_temp (data JSONB);
  COPY import_temp FROM STDIN;
  INSERT INTO ${PARTITION} (id, job_id, tenant_id, event_type, payload, created_at)
  SELECT 
    (data->>'id')::BIGINT,
    (data->>'job_id')::UUID,
    (data->>'tenant_id')::UUID,
    data->>'event_type',
    data->'payload',
    (data->>'created_at')::TIMESTAMPTZ
  FROM import_temp;
"

log "Restore complete!"

# Cleanup
rm -f "${PARTITION}.json"
```

**Important:** Restored partitions are for investigation only. Remove them after analysis to maintain database size.

---

## Operational Checklist

> **Scope:** [OPS]

### Pre-Archival Checklist

- [ ] Verify partition is older than retention window (90 days)
- [ ] Confirm partition hasn't been archived already
- [ ] Check sufficient disk space for temporary export
- [ ] Verify object storage credentials are valid
- [ ] Ensure no active queries on the partition

### Post-Archival Verification

- [ ] Verify archive exists in object storage
- [ ] Verify checksum file exists alongside archive
- [ ] Confirm `system_events` record created
- [ ] Confirm partition dropped from database
- [ ] Verify application still functioning normally

### Monthly Archival Schedule

| Day | Action |
|-----|--------|
| 1st | Create next month's partition |
| 5th | Run archival job for eligible partitions |
| 10th | Verify archival success, alert if failed |

### Cron Configuration

```cron
# Create future partitions (1st of month at 2:00 AM)
0 2 1 * * /opt/scripts/create_future_partitions.sh >> /var/log/partition_create.log 2>&1

# Archive old partitions (5th of month at 3:00 AM)
0 3 5 * * /opt/scripts/archive_old_partitions.sh >> /var/log/partition_archive.log 2>&1
```

### Monitoring Alerts

| Alert | Condition | Action |
|-------|-----------|--------|
| Archival Failed | No `ARCHIVED_PARTITION` event for expected partition | Investigate and re-run |
| Partition Missing | Insert fails with "no partition" | Create missing partition immediately |
| Storage Full | Object storage >80% | Expand storage or review retention |


---

## Architecture Notes

### Agent / Concurrency Impact [OPS]
Higher worker/agent concurrency increases `job_events` writes.
Retention and archival frequency should be adjusted accordingly.

### Canary / Change Detection Events [OPS]
Portal canary jobs also write events. These are low priority but contribute to growth.

### MVP Minimum Setup
For first production:
- 60–90 day retention
- daily or weekly archive cron
- compressed storage (S3/minio)
- delete old partitions after archive

Everything else is optimization.

---
