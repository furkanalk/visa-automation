## Scope Labels

This document defines the **core database schema (source of truth)**.

- **[MVP REQUIRED]** → required for correct system behavior
- **[PHASED / LATER]** → future/extended capabilities
- **[OPS]** → performance/maintenance guidance

This file is safety‑critical. Do NOT remove or simplify core tables.

---

# Database Schema (Prisma / SQL)

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md) | [Partitioning Guide](../database/VISA_DB_PARTITIONING.md) | [Archival Guide](../database/VISA_JOB_EVENTS_ARCHIVAL.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Entity Relationship Diagram](#entity-relationship-diagram)
3. [Table Definitions](#table-definitions)
   - [tenants](#tenants)
   - [jobs](#jobs) (includes billing fields)
   - [job_runs](#job_runs)
   - [hitl_tasks](#hitl_tasks)
   - [evidence_packs](#evidence_packs) (NEW: billing-grade proof)
   - [job_events](#job_events-append-only) (includes billing events)
4. [Schema Notes](#schema-notes)
5. [Index Strategy](#index-strategy)
   - [Billing & Evidence Pack Indexes](#billing--evidence-pack-indexes)

---

## Overview

The database schema is designed to support the Visa Application Automation system with the following goals:

| Goal | Implementation |
|------|----------------|
| **Multi-tenancy** | All tables include `tenant_id` for data isolation |
| **Auditability** | `job_events` provides immutable audit trail |
| **Resumability** | Job state and checkpoints enable deterministic resume |
| **HITL Support** | `hitl_tasks` tracks human intervention requests |
| **Scalability** | `job_events` is partitioned for growth management |

---

## Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    ENTITY RELATIONSHIP DIAGRAM                                                   │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                                            TENANTS                                                       │    │
│  │  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐    │    │
│  │  │  id (PK)  │  name  │  daily_quota  │  max_concurrent_jobs  │  created_at                       │    │    │
│  │  └─────────────────────────────────────────────────────────────────────────────────────────────────┘    │    │
│  └────────────────────────────────────┬────────────────────────────────────────────────────────────────────┘    │
│                                       │                                                                          │
│                                       │ 1:N                                                                      │
│                                       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐    │
│  │                                              JOBS                                                        │    │
│  │  ┌─────────────────────────────────────────────────────────────────────────────────────────────────┐    │    │
│  │  │  id (PK)  │  tenant_id (FK)  │  status  │  priority  │  current_state  │  created_at  │ updated_at │    │    │
│  │  └─────────────────────────────────────────────────────────────────────────────────────────────────┘    │    │
│  └────────────────────────────────────┬──────────────────────────────────┬─────────────────────────────────┘    │
│                                       │                                  │                                       │
│                        ┌──────────────┘                                  └──────────────┐                        │
│                        │ 1:N                                                            │ 1:N                    │
│                        ▼                                                                ▼                        │
│  ┌─────────────────────────────────────────────────────┐    ┌─────────────────────────────────────────────────┐  │
│  │                    JOB_RUNS                          │    │                   HITL_TASKS                     │  │
│  │  ┌───────────────────────────────────────────────┐  │    │  ┌───────────────────────────────────────────┐  │  │
│  │  │  id (PK)  │  job_id (FK)  │  lease_owner      │  │    │  │  id (PK)  │  job_id (FK)  │  expires_at   │  │  │
│  │  │           │  heartbeat_at  │  started_at      │  │    │  │           │  context_ref  │  status       │  │  │
│  │  │           │  ended_at                         │  │    │  └───────────────────────────────────────────┘  │  │
│  │  └───────────────────────────────────────────────┘  │    └─────────────────────────────────────────────────┘  │
│  └─────────────────────────────────────────────────────┘                                                         │
│                                       │                                                                          │
│                                       │ N:1 (via job_id)                                                         │
│                                       │                                                                          │
│                                       │                      ┌───────────────────────────────────────────────┐   │
│                                       │                      │             JOB_EVENTS (Append-Only)          │   │
│                                       │                      │  ┌───────────────────────────────────────┐   │   │
│                                       └─────────────────────▶│  │  id (PK)  │  job_id  │  tenant_id     │   │   │
│                                                              │  │  event_type  │  payload (JSONB)       │   │   │
│                                                              │  │  created_at                           │   │   │
│                                                              │  └───────────────────────────────────────┘   │   │
│                                                              │                                               │   │
│                                                              │  Partitioned by created_at (monthly)         │   │
│                                                              └───────────────────────────────────────────────┘   │
│                                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Table Definitions

### tenants

The `tenants` table stores customer/organization information and their quotas.

```sql
CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  daily_quota   INTEGER NOT NULL DEFAULT 100,
  max_concurrent_jobs INTEGER NOT NULL DEFAULT 5,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for name lookups (if needed)
CREATE INDEX idx_tenants_name ON tenants (name);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique tenant identifier |
| `name` | TEXT | NOT NULL | Human-readable tenant name |
| `daily_quota` | INTEGER | NOT NULL, DEFAULT 100 | Maximum jobs per day |
| `max_concurrent_jobs` | INTEGER | NOT NULL, DEFAULT 5 | Maximum jobs running simultaneously |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last modification timestamp |

**Usage:**
- Admission control checks `daily_quota` before accepting new jobs
- Worker scheduling respects `max_concurrent_jobs` limit
- Multi-tenant isolation enforced via `tenant_id` in related tables

---

### jobs

The `jobs` table stores individual visa application records and their current state.

```sql
CREATE TYPE job_status AS ENUM (
  'DRAFTED',
  'QUEUED',
  'LOGIN_PROCESS',
  'LOGGED_IN',
  'FORM_FILLING',
  'PAUSED',
  'WAITING_HITL',
  'PROCESSING',
  'FINALIZING',
  'COMPLETED',
  'FAILED_RETRYABLE',
  'FAILED_PROXY_LOST',
  'FAILED_TERMINAL'
);

-- Billing status enum
CREATE TYPE billing_status AS ENUM (
  'NOT_ELIGIBLE',
  'ELIGIBLE',
  'BILLED',
  'DISPUTED'
);

CREATE TABLE jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  status          job_status NOT NULL DEFAULT 'DRAFTED',
  priority        INTEGER NOT NULL DEFAULT 0,
  current_state   JSONB,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 3,
  -- Adapter/Version tracking (for incident correlation)
  adapter_name    TEXT,                                      -- e.g., 'visa_consulate_tr', 'visa_us_b1b2'
  adapter_version TEXT,                                      -- e.g., 'v2.1.3', git commit hash
  -- Billing fields
  billable_outcome  TEXT,                                    -- Final outcome for billing (e.g., 'VISA_SUBMITTED', 'APPOINTMENT_BOOKED')
  billing_status    billing_status NOT NULL DEFAULT 'NOT_ELIGIBLE',
  billed_at         TIMESTAMPTZ,                             -- When billing was processed
  billing_ref       TEXT,                                    -- External billing system reference
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for common queries
CREATE INDEX idx_jobs_tenant_id ON jobs (tenant_id);
CREATE INDEX idx_jobs_status ON jobs (status);
CREATE INDEX idx_jobs_tenant_status ON jobs (tenant_id, status);
CREATE INDEX idx_jobs_priority ON jobs (priority DESC) WHERE status = 'QUEUED';

-- Billing indexes
CREATE INDEX idx_jobs_billing_status ON jobs (billing_status) 
WHERE billing_status IN ('ELIGIBLE', 'DISPUTED');
CREATE INDEX idx_jobs_tenant_billing ON jobs (tenant_id, billing_status, billed_at);

-- Adapter version indexes (for incident correlation)
CREATE INDEX idx_jobs_adapter_version ON jobs (adapter_name, adapter_version);
CREATE INDEX idx_jobs_adapter_failed ON jobs (adapter_name, adapter_version, status)
WHERE status IN ('FAILED_RETRYABLE', 'FAILED_TERMINAL');
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique job identifier |
| `tenant_id` | UUID | NOT NULL, FK → tenants | Owning tenant |
| `status` | job_status | NOT NULL, DEFAULT 'DRAFTED' | Current FSM state |
| `priority` | INTEGER | NOT NULL, DEFAULT 0 | Queue priority (higher = more urgent) |
| `current_state` | JSONB | - | Checkpoint data for resume |
| `retry_count` | INTEGER | NOT NULL, DEFAULT 0 | Current retry attempt |
| `max_retries` | INTEGER | NOT NULL, DEFAULT 3 | Maximum allowed retries |
| `adapter_name` | TEXT | - | Target adapter identifier (e.g., 'visa_consulate_tr') |
| `adapter_version` | TEXT | - | Adapter version/commit (e.g., 'v2.1.3', 'abc123') |
| `billable_outcome` | TEXT | - | Final outcome for billing purposes |
| `billing_status` | billing_status | NOT NULL, DEFAULT 'NOT_ELIGIBLE' | Current billing state |
| `billed_at` | TIMESTAMPTZ | - | When billing was processed |
| `billing_ref` | TEXT | - | External billing system reference |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Job creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last state change timestamp |

**Billing Status Flow:**

```
NOT_ELIGIBLE ──▶ ELIGIBLE ──▶ BILLED
                    │
                    └──▶ DISPUTED ──▶ BILLED (after resolution)
```

| Status | Description |
|--------|-------------|
| `NOT_ELIGIBLE` | Job not completed or evidence pack not sealed |
| `ELIGIBLE` | Job completed, evidence pack sealed, ready for billing |
| `BILLED` | Billing processed, invoice generated |
| `DISPUTED` | Customer disputed the charge |

**FSM States Explained:**

| State | Description |
|-------|-------------|
| `DRAFTED` | Job created but not submitted for processing |
| `QUEUED` | Waiting in queue for worker pickup |
| `LOGIN_PROCESS` | Worker attempting to authenticate with target site |
| `LOGGED_IN` | Successfully authenticated, ready for form work |
| `FORM_FILLING` | Actively filling application forms |
| `PAUSED` | Safe parking state (shutdown, manual pause) |
| `WAITING_HITL` | Waiting for human intervention |
| `PROCESSING` | Final submission and confirmation phase |
| `COMPLETED` | Job finished successfully |
| `FAILED_RETRYABLE` | Temporary failure, retry possible |
| `FAILED_TERMINAL` | Permanent failure, requires manual intervention |

**current_state JSONB Structure:**

```json
{
  "checkpoint": "FORM_PAGE_2",
  "form_data": {
    "applicant_name": "John Doe",
    "passport_number": "AB123456",
    "completed_sections": ["personal_info", "travel_details"]
  },
  "target_site_ids": {
    "application_id": "VS-2026-001234",
    "session_ref": "sess_abc123"
  },
  "proxy_session": {
    "proxy_session_id": "sess_proxy_xyz789",
    "proxy_provider": "residential_provider_a",
    "last_good_ip": "203.0.113.42",
    "session_created_at": "2026-01-25T10:00:00Z",
    "session_expires_at": "2026-01-25T22:00:00Z"
  },
  "last_action": "filled_travel_section",
  "last_action_at": "2026-01-25T10:30:00Z"
}
```

**Proxy Session Fields (MANDATORY for Resume):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `proxy_session_id` | string | MUST | Unique identifier for proxy session binding |
| `proxy_provider` | string | MUST | Provider name for failover logic |
| `last_good_ip` | string | SHOULD | Last known egress IP for debugging |
| `session_created_at` | timestamp | SHOULD | When proxy session was established |
| `session_expires_at` | timestamp | SHOULD | Proxy session expiration for refresh logic |

> **Contract:** Worker MUST use the same `proxy_session_id` when resuming a job to maintain IP continuity with target site. See [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md#14-proxy-session-binding-must) for full requirements.

---

### job_runs

The `job_runs` table tracks individual execution attempts for each job.

```sql
CREATE TABLE job_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs(id),
  lease_owner   TEXT NOT NULL,
  heartbeat_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'RUNNING',
  error_message TEXT
);

-- Index for finding stuck runs
CREATE INDEX idx_job_runs_job_id ON job_runs (job_id);
CREATE INDEX idx_job_runs_heartbeat ON job_runs (heartbeat_at) WHERE status = 'RUNNING';
CREATE INDEX idx_job_runs_lease_owner ON job_runs (lease_owner);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique run identifier |
| `job_id` | UUID | NOT NULL, FK → jobs | Parent job |
| `lease_owner` | TEXT | NOT NULL | Worker ID holding the lease |
| `heartbeat_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Last heartbeat timestamp |
| `started_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Run start time |
| `ended_at` | TIMESTAMPTZ | - | Run end time (NULL if running) |
| `status` | TEXT | NOT NULL, DEFAULT 'RUNNING' | Run status (RUNNING, COMPLETED, FAILED, ABANDONED) |
| `error_message` | TEXT | - | Error details if failed |

**Run Statuses:**

| Status | Description |
|--------|-------------|
| `RUNNING` | Currently being processed |
| `COMPLETED` | Finished successfully |
| `FAILED` | Ended with error |
| `ABANDONED` | Worker crashed, detected via stale heartbeat |

**Heartbeat Usage:**

Workers update `heartbeat_at` every 15 seconds (configurable). If `heartbeat_at` is older than 2× the heartbeat interval and `status = 'RUNNING'`, the job is considered stuck and marked `ABANDONED`.

---

### hitl_tasks

The `hitl_tasks` table tracks human-in-the-loop intervention requests.

```sql
CREATE TYPE hitl_status AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TABLE hitl_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID NOT NULL REFERENCES jobs(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  context_ref   TEXT NOT NULL,
  status        hitl_status NOT NULL DEFAULT 'PENDING',
  assigned_to   TEXT,
  result        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

-- Index for finding pending tasks
CREATE INDEX idx_hitl_tasks_job_id ON hitl_tasks (job_id);
CREATE INDEX idx_hitl_tasks_status ON hitl_tasks (status) WHERE status IN ('PENDING', 'IN_PROGRESS');
CREATE INDEX idx_hitl_tasks_expires ON hitl_tasks (expires_at) WHERE status = 'PENDING';
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique task identifier |
| `job_id` | UUID | NOT NULL, FK → jobs | Associated job |
| `expires_at` | TIMESTAMPTZ | NOT NULL | SLA expiry time |
| `context_ref` | TEXT | NOT NULL | Path to context pack (screenshot, HTML) |
| `status` | hitl_status | NOT NULL, DEFAULT 'PENDING' | Current task status |
| `assigned_to` | TEXT | - | Operator handling the task |
| `result` | JSONB | - | Operator's response data |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT now() | Task creation time |
| `completed_at` | TIMESTAMPTZ | - | Task completion time |

**HITL Statuses:**

| Status | Description |
|--------|-------------|
| `PENDING` | Waiting for operator assignment |
| `IN_PROGRESS` | Operator is working on it |
| `COMPLETED` | Successfully resolved |
| `EXPIRED` | SLA deadline passed without resolution |
| `CANCELLED` | Task cancelled (job cancelled, etc.) |

**context_ref Format:**

The `context_ref` is a path to the context pack stored on encrypted disk:
```
/data/hitl/2026/01/25/{job_id}/{timestamp}/
  ├── screenshot.png
  ├── dom.html
  └── context.json
```

---

### evidence_packs

The `evidence_packs` table stores billing-grade proof of completed work. Evidence packs are immutable once sealed and provide defensible proof for the "pay per successful submission" billing model.

```sql
CREATE TYPE evidence_pack_status AS ENUM (
  'DRAFT',       -- Being assembled, not yet complete
  'SEALED',      -- Finalized, immutable, ready for billing
  'REVOKED'      -- Invalidated (rare, requires admin + audit)
);

CREATE TABLE evidence_packs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL UNIQUE REFERENCES jobs(id),
  tenant_id       UUID NOT NULL,
  status          evidence_pack_status NOT NULL DEFAULT 'DRAFT',
  
  -- Storage reference (immutable object path)
  storage_ref     TEXT NOT NULL,              -- e.g., "s3://bucket/evidence/2026/01/job-uuid/pack.zip"
  
  -- Integrity verification
  manifest_hash   TEXT NOT NULL,              -- SHA-256 of manifest.json
  manifest_sig    TEXT,                       -- HMAC or asymmetric signature (optional)
  signing_method  TEXT,                       -- 'SHA256', 'HMAC-SHA256', 'Ed25519'
  
  -- Pack contents metadata
  contains_screenshot     BOOLEAN NOT NULL DEFAULT false,
  contains_html_snapshot  BOOLEAN NOT NULL DEFAULT false,
  contains_fsm_timeline   BOOLEAN NOT NULL DEFAULT false,
  contains_hitl_records   BOOLEAN NOT NULL DEFAULT false,
  
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sealed_at       TIMESTAMPTZ,                -- When status changed to SEALED
  revoked_at      TIMESTAMPTZ,                -- When status changed to REVOKED (if ever)
  revoked_reason  TEXT                        -- Reason for revocation (if applicable)
);

-- Index for job lookup (1:1 relationship)
CREATE UNIQUE INDEX idx_evidence_packs_job_id ON evidence_packs (job_id);

-- Index for tenant queries
CREATE INDEX idx_evidence_packs_tenant ON evidence_packs (tenant_id, created_at DESC);

-- Index for billing queries (find sealed packs ready for billing)
CREATE INDEX idx_evidence_packs_sealed ON evidence_packs (tenant_id, sealed_at)
WHERE status = 'SEALED';
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique pack identifier |
| `job_id` | UUID | NOT NULL, UNIQUE, FK → jobs | Associated job (1:1) |
| `tenant_id` | UUID | NOT NULL | Tenant for queries |
| `status` | evidence_pack_status | NOT NULL, DEFAULT 'DRAFT' | Pack lifecycle state |
| `storage_ref` | TEXT | NOT NULL | Immutable object storage path |
| `manifest_hash` | TEXT | NOT NULL | SHA-256 hash of manifest.json |
| `manifest_sig` | TEXT | - | HMAC or asymmetric signature |
| `signing_method` | TEXT | - | Algorithm used for signing |
| `contains_*` | BOOLEAN | NOT NULL | Flags for pack contents |
| `sealed_at` | TIMESTAMPTZ | - | When pack was finalized |

**Evidence Pack Status Flow:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        EVIDENCE PACK LIFECYCLE                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Job reaches terminal state (COMPLETED)                                          │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  DRAFT                                                                  │    │
│  │  • Assembling evidence (screenshots, timeline, etc.)                    │    │
│  │  • Can be modified                                                      │    │
│  │  • Not billable                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Sealing process (hash + optional signature)                              │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  SEALED                                                                 │    │
│  │  • Immutable (no modifications allowed)                                 │    │
│  │  • Billable (triggers BILLING_ELIGIBLE)                                 │    │
│  │  • Defensible proof for billing disputes                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Rare: admin action with audit trail                                      │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  REVOKED (rare)                                                         │    │
│  │  • Invalidated due to error or fraud                                    │    │
│  │  • Requires explicit reason                                             │    │
│  │  • Original data preserved for audit                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Manifest.json Structure:**

```json
{
  "version": "1.0",
  "job_id": "uuid-123",
  "tenant_id": "uuid-tenant",
  "sealed_at": "2026-01-25T12:00:00Z",
  "outcome": {
    "status": "COMPLETED",
    "confirmation_number": "VISA-2026-ABC123",
    "completed_at": "2026-01-25T11:55:00Z"
  },
  "contents": {
    "final_screenshot": {
      "file": "screenshot_final.png",
      "sha256": "abc123..."
    },
    "fsm_timeline": {
      "file": "timeline.json",
      "sha256": "def456...",
      "event_count": 47
    },
    "hitl_records": {
      "file": "hitl.json",
      "sha256": "ghi789...",
      "task_count": 2
    }
  },
  "integrity": {
    "manifest_hash": "sha256:...",
    "signing_method": "HMAC-SHA256",
    "signature": "..."
  }
}
```

> **Verification & Signing:** See [VISA_LOGGING_STRATEGY.md](../security/VISA_LOGGING_STRATEGY.md#evidence-pack-sealing--signing) for detailed sealing and verification procedures.

---

### job_events (Append-Only)

The `job_events` table is an immutable audit log of all job state changes and significant actions.

```sql
-- Base table (partitioned)
CREATE TABLE job_events (
  id            BIGSERIAL,
  job_id        UUID NOT NULL,
  tenant_id     UUID NOT NULL,
  event_type    TEXT NOT NULL,
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partition example
CREATE TABLE job_events_2026_01
PARTITION OF job_events
FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- Indexes on active partitions
CREATE INDEX idx_job_events_2026_01_job_id ON job_events_2026_01 (job_id);
CREATE INDEX idx_job_events_2026_01_tenant_id ON job_events_2026_01 (tenant_id);
CREATE INDEX idx_job_events_2026_01_type ON job_events_2026_01 (event_type);
```

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | BIGSERIAL | Part of composite PK | Auto-incrementing event ID |
| `job_id` | UUID | NOT NULL | Associated job |
| `tenant_id` | UUID | NOT NULL | Tenant for filtering/isolation |
| `event_type` | TEXT | NOT NULL | Type of event |
| `payload` | JSONB | - | Event-specific data |
| `created_at` | TIMESTAMPTZ | NOT NULL, Part of composite PK | Event timestamp |

**Event Types:**

| Event Type | Description | Payload Example |
|------------|-------------|-----------------|
| `JOB_CREATED` | Job was created | `{"source": "api", "idempotency_key": "..."}` |
| `STATE_TRANSITION` | FSM state changed | `{"from": "QUEUED", "to": "LOGIN_PROCESS"}` |
| `RUN_STARTED` | Worker began processing | `{"run_id": "...", "worker_id": "..."}` |
| `RUN_COMPLETED` | Run finished | `{"run_id": "...", "duration_ms": 45000}` |
| `RUN_ABANDONED` | Worker crashed | `{"run_id": "...", "last_heartbeat": "..."}` |
| `CHECKPOINT_SAVED` | Progress saved | `{"checkpoint": "FORM_PAGE_2"}` |
| `HITL_REQUESTED` | Human intervention needed | `{"task_id": "...", "reason": "captcha"}` |
| `HITL_COMPLETED` | Human task resolved | `{"task_id": "...", "operator": "..."}` |
| `RETRY_SCHEDULED` | Job will be retried | `{"attempt": 2, "delay_ms": 30000}` |
| `PAUSED_FOR_SHUTDOWN` | Graceful pause | `{"reason": "sigterm"}` |

**Billing & Evidence Pack Events:**

| Event Type | Description | Payload Example |
|------------|-------------|-----------------|
| `EVIDENCE_PACK_GENERATED` | Evidence pack created (DRAFT) | `{"pack_id": "...", "contents": ["screenshot", "timeline"]}` |
| `EVIDENCE_PACK_SEALED` | Evidence pack finalized (immutable) | `{"pack_id": "...", "manifest_hash": "sha256:...", "sealed_at": "..."}` |
| `EVIDENCE_PACK_REVOKED` | Evidence pack invalidated (rare) | `{"pack_id": "...", "reason": "...", "revoked_by": "admin_id"}` |
| `BILLING_ELIGIBLE` | Job ready for billing | `{"pack_id": "...", "billable_outcome": "VISA_SUBMITTED"}` |
| `BILLED` | Billing processed | `{"billing_ref": "INV-2026-001", "amount": "...", "currency": "..."}` |
| `BILLING_DISPUTED` | Customer disputed charge | `{"dispute_id": "...", "reason": "...", "disputed_at": "..."}` |
| `DISPUTE_RESOLVED` | Dispute closed | `{"dispute_id": "...", "resolution": "upheld|refunded", "resolved_at": "..."}` |

**Billing Event Sequence (Success Path):**

```
JOB_CREATED → ... → STATE_TRANSITION (to COMPLETED)
    │
    ├── EVIDENCE_PACK_GENERATED
    │
    ├── EVIDENCE_PACK_SEALED
    │
    ├── BILLING_ELIGIBLE
    │
    └── BILLED
```

**Immutability Guarantee:**

Events are NEVER updated or deleted. The `job_events` table is append-only:
- No `UPDATE` operations allowed
- No `DELETE` operations (except partition drops during archival)
- Provides complete audit trail for debugging and compliance

> **Partitioning Details:** See [VISA_DB_PARTITIONING.md](../database/VISA_DB_PARTITIONING.md)  
> **Archival Process:** See [VISA_JOB_EVENTS_ARCHIVAL.md](../database/VISA_JOB_EVENTS_ARCHIVAL.md)

---

## Schema Notes

### Multi-Tenancy

All tables that store customer data include `tenant_id`:

| Table | Has tenant_id | Isolation Method |
|-------|---------------|------------------|
| `tenants` | N/A (is the tenant table) | - |
| `jobs` | ✅ Yes | FK to tenants |
| `job_runs` | Via job_id | Join through jobs |
| `hitl_tasks` | Via job_id | Join through jobs |
| `job_events` | ✅ Yes (denormalized) | Direct column for fast filtering |

**Why `tenant_id` is denormalized in `job_events`:**
- Allows fast filtering without joins
- Critical for high-volume event queries
- Partition pruning benefits from direct access

### Foreign Keys

All foreign key relationships are enforced at the database level:

```
tenants.id  ←──  jobs.tenant_id
jobs.id     ←──  job_runs.job_id
jobs.id     ←──  hitl_tasks.job_id
```

**Note:** `job_events` does NOT have foreign keys to maintain write performance and allow partition management (dropping old partitions).

### Partitioning

The `job_events` table uses PostgreSQL RANGE partitioning by `created_at`:

| Aspect | Value |
|--------|-------|
| **Partition Key** | `created_at` (TIMESTAMP WITH TIME ZONE) |
| **Partition Interval** | Monthly |
| **Naming Convention** | `job_events_YYYY_MM` |

Benefits:
- Fast pruning for time-range queries
- Easy archival (drop entire partitions)
- Efficient VACUUM (per-partition)

---

## Index Strategy

### Index Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Index hot data** | Full indexing on active partitions |
| **Minimal on cold data** | Reduce indexes before archival |
| **Cover common queries** | Composite indexes for frequent access patterns |
| **Monitor usage** | Remove unused indexes |

### Recommended Indexes by Table

**tenants:**
```sql
-- Primary key (automatic)
-- Name lookup (if searching by name)
CREATE INDEX idx_tenants_name ON tenants (name);
```

**jobs:**
```sql
-- Primary key (automatic)
-- Tenant filtering (most common)
CREATE INDEX idx_jobs_tenant_id ON jobs (tenant_id);
-- Status filtering
CREATE INDEX idx_jobs_status ON jobs (status);
-- Combined for dashboard queries
CREATE INDEX idx_jobs_tenant_status ON jobs (tenant_id, status);
-- Priority queue (partial index for efficiency)
CREATE INDEX idx_jobs_priority ON jobs (priority DESC) WHERE status = 'QUEUED';
```

**job_runs:**
```sql
-- Primary key (automatic)
-- Finding runs for a job
CREATE INDEX idx_job_runs_job_id ON job_runs (job_id);
-- Finding stuck runs
CREATE INDEX idx_job_runs_heartbeat ON job_runs (heartbeat_at) WHERE status = 'RUNNING';
-- Finding by worker
CREATE INDEX idx_job_runs_lease_owner ON job_runs (lease_owner);
```

**hitl_tasks:**
```sql
-- Primary key (automatic)
-- Job lookup
CREATE INDEX idx_hitl_tasks_job_id ON hitl_tasks (job_id);
-- Operator dashboard (pending/in-progress tasks)
CREATE INDEX idx_hitl_tasks_status ON hitl_tasks (status) WHERE status IN ('PENDING', 'IN_PROGRESS');
-- SLA monitoring
CREATE INDEX idx_hitl_tasks_expires ON hitl_tasks (expires_at) WHERE status = 'PENDING';
```

**job_events (per partition):**
```sql
-- Primary key includes created_at (automatic)
-- Job history lookup
CREATE INDEX idx_job_events_YYYY_MM_job_id ON job_events_YYYY_MM (job_id);
-- Tenant filtering
CREATE INDEX idx_job_events_YYYY_MM_tenant_id ON job_events_YYYY_MM (tenant_id);
-- Event type filtering
CREATE INDEX idx_job_events_YYYY_MM_type ON job_events_YYYY_MM (event_type);
```

### Hot Partition Index Strategy for job_events

The `job_events` table is **append-only and write-heavy**. Index strategy must optimize for common query patterns while minimizing write overhead.

**Recommended Hot Partition Indexes:**

```sql
-- For current month's partition (e.g., job_events_2026_01)

-- 1. Job history lookup: "Get all events for job X"
CREATE INDEX idx_job_events_2026_01_job_id 
ON job_events_2026_01 (job_id);

-- 2. Tenant filtering: "Get recent events for tenant Y"
CREATE INDEX idx_job_events_2026_01_tenant_id 
ON job_events_2026_01 (tenant_id);

-- 3. Last N events query (most common API pattern):
--    "Get last 50 events for job X ordered by time"
CREATE INDEX idx_job_events_2026_01_job_time 
ON job_events_2026_01 (job_id, created_at DESC);

-- 4. Tenant + time range (dashboard queries):
--    "Get events for tenant Y in last 24 hours"
CREATE INDEX idx_job_events_2026_01_tenant_time 
ON job_events_2026_01 (tenant_id, created_at DESC);

-- 5. Event type filtering (for specific event analysis):
CREATE INDEX idx_job_events_2026_01_type 
ON job_events_2026_01 (event_type) 
WHERE event_type IN ('FAILED_RETRYABLE', 'FAILED_TERMINAL', 'HITL_REQUESTED');
```

**Common Query Patterns & Indexes:**

| Query Pattern | Index Used | Example |
|---------------|------------|---------|
| Last N events for job | `job_id, created_at DESC` | `SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at DESC LIMIT 50` |
| Tenant activity feed | `tenant_id, created_at DESC` | `SELECT * FROM job_events WHERE tenant_id = ? AND created_at > now() - '24h' ORDER BY created_at DESC` |
| Failure analysis | `event_type` partial | `SELECT * FROM job_events WHERE event_type = 'FAILED_TERMINAL' AND created_at > now() - '7d'` |

---

### Billing & Evidence Pack Indexes

Billing workflows require efficient queries on `jobs`, `evidence_packs`, and billing-related events.

**jobs Table - Billing Indexes:**

```sql
-- Already defined in table creation:
-- CREATE INDEX idx_jobs_billing_status ON jobs (billing_status) 
-- WHERE billing_status IN ('ELIGIBLE', 'DISPUTED');

-- CREATE INDEX idx_jobs_tenant_billing ON jobs (tenant_id, billing_status, billed_at);

-- Additional billing queries:

-- Invoice generation: "Get all ELIGIBLE jobs for tenant"
CREATE INDEX idx_jobs_billing_eligible 
ON jobs (tenant_id, billing_status, created_at)
WHERE billing_status = 'ELIGIBLE';

-- Billing report: "Get all billed jobs in date range"
CREATE INDEX idx_jobs_billed_at 
ON jobs (billed_at, tenant_id)
WHERE billing_status = 'BILLED';

-- Dispute tracking: "Get all disputed jobs"
CREATE INDEX idx_jobs_disputed 
ON jobs (tenant_id, updated_at)
WHERE billing_status = 'DISPUTED';
```

**evidence_packs Table - Indexes (already defined):**

```sql
-- Already defined in table creation:
-- CREATE UNIQUE INDEX idx_evidence_packs_job_id ON evidence_packs (job_id);
-- CREATE INDEX idx_evidence_packs_tenant ON evidence_packs (tenant_id, created_at DESC);
-- CREATE INDEX idx_evidence_packs_sealed ON evidence_packs (tenant_id, sealed_at)
--   WHERE status = 'SEALED';
```

**job_events - Billing Event Queries:**

```sql
-- Query billing events for job
CREATE INDEX idx_job_events_billing_events
ON job_events_2026_01 (job_id, event_type)
WHERE event_type IN (
  'EVIDENCE_PACK_GENERATED', 
  'EVIDENCE_PACK_SEALED', 
  'BILLING_ELIGIBLE', 
  'BILLED', 
  'BILLING_DISPUTED', 
  'DISPUTE_RESOLVED'
);
```

**Common Billing Query Patterns:**

| Query | Index Used | Example |
|-------|-----------|---------|
| Eligible jobs for billing | `idx_jobs_billing_eligible` | `SELECT * FROM jobs WHERE tenant_id = ? AND billing_status = 'ELIGIBLE'` |
| Jobs billed in period | `idx_jobs_billed_at` | `SELECT * FROM jobs WHERE billed_at BETWEEN ? AND ? AND tenant_id = ?` |
| Disputed jobs | `idx_jobs_disputed` | `SELECT * FROM jobs WHERE billing_status = 'DISPUTED' AND tenant_id = ?` |
| Evidence pack for job | `idx_evidence_packs_job_id` | `SELECT * FROM evidence_packs WHERE job_id = ? AND status = 'SEALED'` |
| Tenant sealed packs | `idx_evidence_packs_sealed` | `SELECT * FROM evidence_packs WHERE tenant_id = ? AND status = 'SEALED' ORDER BY sealed_at DESC` |

---

### Autovacuum Tuning for job_events

The `job_events` table is **append-only** with high write volume (~50,000 rows/day). Default autovacuum settings are insufficient.

**Recommended Settings (per-table):**

```sql
-- Apply to the parent table; inherited by partitions
ALTER TABLE job_events SET (
  autovacuum_vacuum_scale_factor = 0.01,      -- Vacuum at 1% dead tuples (default 20%)
  autovacuum_analyze_scale_factor = 0.005,    -- Analyze at 0.5% changes (default 10%)
  autovacuum_vacuum_cost_delay = 2,           -- Faster vacuum (default 2ms)
  autovacuum_vacuum_cost_limit = 1000         -- More aggressive (default 200)
);
```

**Why These Settings:**

| Setting | Default | Recommended | Rationale |
|---------|---------|-------------|-----------|
| `vacuum_scale_factor` | 0.20 | 0.01 | Append-only tables rarely have dead tuples; but when they do, vacuum quickly |
| `analyze_scale_factor` | 0.10 | 0.005 | Keep statistics fresh for query planner |
| `vacuum_cost_delay` | 2ms | 2ms | Keep default; adjust if I/O is a concern |
| `vacuum_cost_limit` | 200 | 1000 | Allow more aggressive vacuuming |

**Monitoring Autovacuum:**

```sql
-- Check when tables were last vacuumed/analyzed
SELECT 
  schemaname,
  relname,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze,
  n_dead_tup,
  n_live_tup
FROM pg_stat_user_tables
WHERE relname LIKE 'job_events%'
ORDER BY relname;

-- Check for tables needing vacuum
SELECT 
  schemaname || '.' || relname as table,
  n_dead_tup,
  n_live_tup,
  round(n_dead_tup::numeric / nullif(n_live_tup, 0) * 100, 2) as dead_pct
FROM pg_stat_user_tables
WHERE n_dead_tup > 1000
ORDER BY n_dead_tup DESC;
```

---

### Index Maintenance

| Task | Frequency | Purpose |
|------|-----------|---------|
| `REINDEX` | Monthly or after heavy writes | Reduce index bloat |
| `pg_stat_user_indexes` review | Weekly | Identify unused indexes |
| Drop indexes on old partitions | Before archival | Reduce storage |
| `ANALYZE` hot partitions | After bulk inserts | Keep statistics fresh |

**Index Usage Monitoring:**

```sql
-- Find unused indexes (candidates for removal)
SELECT 
  schemaname || '.' || relname as table,
  indexrelname as index,
  idx_scan as times_used,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Find most used indexes (ensure they exist on hot partitions)
SELECT 
  schemaname || '.' || relname as table,
  indexrelname as index,
  idx_scan as times_used,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE idx_scan > 0
ORDER BY idx_scan DESC
LIMIT 20;
```

---

## Architecture Notes

### Agent / Portal Scheduling [MVP REQUIRED]
Portal concurrency is controlled at runtime via **agent policies** (SERIAL/PARALLEL + max_concurrency).
No additional DB schema is required for scheduling.

### Canary / Change Detection Events [MVP REQUIRED]
`job_events` should support:
- PORTAL_CHANGE_DETECTED

Used for:
- DOM change alerts
- adapter redesign triggers

### Evidence Modes
- Light evidence (MVP): reference + datetime + screenshot
- Sealed evidence (Later): ZIP + manifest + signature

Both still pass through FINALIZING state.

---
