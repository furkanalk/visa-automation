## Scope Labels

This document defines **how workers (agents) behave at runtime**.

- **[MVP REQUIRED]** → mandatory behavior for first production
- **[PHASED / LATER]** → future optimizations
- **[OPS]** → operational/monitoring practices

This is a **runtime behavior spec**. Do not remove core safety logic (lease, resume, fencing).

---

# Worker Lifecycle & Deterministic Resume

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md) | [Production Runbook](../operations/VISA_PRODUCTION_RUNBOOK.md) | [Grafana Dashboards](../operations/VISA_GRAFANA_DASHBOARDS.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Startup Sequence](#startup)
3. [Job Acquisition](#job-acquisition)
4. [Execution Loop](#execution-loop)
5. [HITL (Human-in-the-Loop)](#hitl)
6. [SIGTERM Handling](#sigterm-handling)
7. [Crash Recovery](#crash-recovery)
8. [Lifecycle Diagram](#lifecycle-diagram)
9. [Lease Fencing (Critical Actions)](#lease-fencing-critical-actions)
10. [Proxy Session Failover](#proxy-session-failover)
11. [Related Documents](#related-documents)

---

## Overview


> **Scope:** [MVP REQUIRED]
Workers are the core execution units of the Visa Automation system. Each worker is responsible for:

- Acquiring jobs from the queue
- Executing browser automation steps
- Checkpointing progress for resume capability
- Handling graceful shutdowns
- Supporting human-in-the-loop interventions

**Key Design Principles:**

| Principle | Description |
|-----------|-------------|
| **Exclusive Ownership** | Only one worker can process a job at a time (lease-based) |
| **Deterministic Execution** | Same inputs always produce same outputs |
| **Checkpoint-based Resume** | Progress saved after every critical step |
| **Graceful Degradation** | Failures result in safe states, not data loss |

---

## Startup


> **Scope:** [MVP REQUIRED]
When a worker process starts, it follows a strict initialization sequence to ensure it's ready to process jobs safely.

### Startup Sequence Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           WORKER STARTUP SEQUENCE                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Process Start                                                                   │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: LOAD CONFIGURATION AND SECRETS                                 │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Read environment variables                                           │    │
│  │  • Load secrets from Docker Secrets (mounted files)                     │    │
│  │  • Validate configuration schema                                        │    │
│  │  • Fail fast if any required config is missing                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Config validated ✓                                                       │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: CONNECT TO REDIS AND DATABASE                                  │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Establish Redis connection (for BullMQ queue)                        │    │
│  │  • Establish PostgreSQL connection (for state persistence)              │    │
│  │  • Verify connections are healthy                                       │    │
│  │  • Set up connection retry/reconnect logic                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Connections established ✓                                                │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 3: REGISTER SIGNAL HANDLERS                                       │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • SIGTERM → Graceful shutdown handler                                  │    │
│  │  • SIGINT  → Graceful shutdown handler                                  │    │
│  │  • Uncaught exceptions → Log and safe exit                              │    │
│  │  • Unhandled rejections → Log and safe exit                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Handlers registered ✓                                                    │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 4: START POLLING QUEUE                                            │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Register with BullMQ as a worker                                     │    │
│  │  • Begin polling for available jobs                                     │    │
│  │  • Emit "worker ready" metric                                           │    │
│  │  • Worker is now operational                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ╔═════════════════════════════════════════════════════════════════════════╗    │
│  ║                    WORKER READY - AWAITING JOBS                         ║    │
│  ╚═════════════════════════════════════════════════════════════════════════╝    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Startup Validation Checklist

| Check | Failure Action |
|-------|----------------|
| Configuration schema valid | Exit with error code |
| All required secrets present | Exit with error code |
| Redis connection successful | Exit with error code (or retry with backoff) |
| PostgreSQL connection successful | Exit with error code (or retry with backoff) |
| Signal handlers registered | Exit with error code |

---

## Job Acquisition


> **Scope:** [MVP REQUIRED]
When a job becomes available in the queue, the worker must safely acquire exclusive ownership before processing.

### Acquisition Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           JOB ACQUISITION FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Queue notifies worker of available job                                          │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: ACQUIRE REDIS LEASE                                            │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Attempt SETNX on lease key: job:{job_id}:lease                       │    │
│  │  • Set TTL (e.g., 60 seconds)                                           │    │
│  │  • If SETNX fails → Another worker has the job, skip                    │    │
│  │  • If SETNX succeeds → We own the job exclusively                       │    │
│  │                                                                         │    │
│  │  Lease Key Format: job:{job_id}:lease                                   │    │
│  │  Lease Value: {worker_id}:{timestamp}                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Lease acquired ✓                                                         │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: VERIFY JOB STATE                                               │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Load job record from PostgreSQL                                      │    │
│  │  • Verify job is in expected state (QUEUED or resumable state)          │    │
│  │  • Check job hasn't been cancelled or completed                         │    │
│  │  • If invalid state → Release lease, skip job                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ State verified ✓                                                         │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 3: BEGIN RUN WITH NEW RUN_ID                                      │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Generate unique run_id (UUID)                                        │    │
│  │  • Create job_runs record in PostgreSQL:                                │    │
│  │    - job_id                                                             │    │
│  │    - run_id                                                             │    │
│  │    - lease_owner (this worker's ID)                                     │    │
│  │    - started_at (now)                                                   │    │
│  │    - heartbeat_at (now)                                                 │    │
│  │  • Write job_event: RUN_STARTED                                         │    │
│  │  • Start heartbeat timer                                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ╔═════════════════════════════════════════════════════════════════════════╗    │
│  ║              JOB ACQUIRED - READY FOR EXECUTION                         ║    │
│  ╚═════════════════════════════════════════════════════════════════════════╝    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Heartbeat Mechanism

While processing, the worker must continuously signal that it's alive:

| Aspect | Details |
|--------|---------|
| **Redis Lease Refresh** | Extend TTL every `heartbeat_interval` (e.g., 15 seconds) |
| **Database Heartbeat** | Update `job_runs.heartbeat_at` timestamp |
| **Detection Threshold** | Job considered stuck if `heartbeat_at` > 2× interval |

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           HEARTBEAT LOOP                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Every 15 seconds (configurable):                                                │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Refresh Redis lease TTL                                             │    │
│  │     EXPIRE job:{job_id}:lease 60                                        │    │
│  │                                                                         │    │
│  │  2. Update database heartbeat                                           │    │
│  │     UPDATE job_runs SET heartbeat_at = NOW() WHERE run_id = ?           │    │
│  │                                                                         │    │
│  │  3. If either fails → Log warning, continue processing                  │    │
│  │     (Transient failures are tolerated)                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  If heartbeat stops (worker crash):                                              │
│  • Redis lease expires automatically after TTL                                   │
│  • Stuck job detector finds stale heartbeat_at                                   │
│  • Job becomes available for another worker                                      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Execution Loop


> **Scope:** [MVP REQUIRED]
Once a job is acquired, the worker executes the FSM (Finite State Machine) steps in a deterministic loop.

### Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           FSM EXECUTION LOOP                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  For each FSM step:                                                              │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: ASSERT EXTERNAL STATE                                          │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Before performing any action, verify the external world matches        │    │
│  │  expectations:                                                          │    │
│  │                                                                         │    │
│  │  • Am I still authenticated on the target site?                         │    │
│  │  • Is the page in the expected state?                                   │    │
│  │  • Have previous actions been applied correctly?                        │    │
│  │                                                                         │    │
│  │  If assertion FAILS:                                                    │    │
│  │  → Trigger NEEDS_REAUTH (not immediate job failure)                     │    │
│  │  → Attempt recovery before giving up                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Assertion passed ✓                                                       │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: EXECUTE DETERMINISTIC ACTION                                   │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Perform the next action in the FSM:                                    │    │
│  │                                                                         │    │
│  │  • LOGIN_PROCESS: Enter credentials, submit login form                  │    │
│  │  • FORM_FILLING: Fill form fields, select options                       │    │
│  │  • PROCESSING: Submit application, wait for confirmation                │    │
│  │                                                                         │    │
│  │  Actions are deterministic: same inputs → same outputs                  │    │
│  │  Human-like timing and pacing applied                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Action executed ✓                                                        │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 3: PERSIST CHECKPOINT                                             │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Save current progress to PostgreSQL:                                   │    │
│  │                                                                         │    │
│  │  • Update job.current_state to new FSM state                            │    │
│  │  • Store any collected data (form values, IDs, etc.)                    │    │
│  │  • Checkpoint contains everything needed to resume                      │    │
│  │                                                                         │    │
│  │  This is CRITICAL: if crash occurs after this point,                    │    │
│  │  work is not lost.                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Checkpoint saved ✓                                                       │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 4: EMIT JOB_EVENT                                                 │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Write to append-only job_events table:                                 │    │
│  │                                                                         │    │
│  │  • event_type: STATE_TRANSITION, ACTION_COMPLETED, etc.                 │    │
│  │  • payload: JSON with event details                                     │    │
│  │  • tenant_id, job_id for filtering                                      │    │
│  │  • created_at timestamp                                                 │    │
│  │                                                                         │    │
│  │  Events are immutable - never updated or deleted.                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Event emitted ✓                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Is job complete? (COMPLETED, FAILED_TERMINAL, WAITING_HITL)            │    │
│  │                                                                         │    │
│  │  YES → Exit loop, finalize job                                          │    │
│  │  NO  → Continue to next FSM step                                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### State Transitions

| From State | To State | Trigger |
|------------|----------|---------|
| QUEUED | LOGIN_PROCESS | Worker acquires job |
| LOGIN_PROCESS | LOGGED_IN | Login successful |
| LOGIN_PROCESS | FAILED_RETRYABLE | Login failed (retryable) |
| LOGGED_IN | FORM_FILLING | Begin form automation |
| FORM_FILLING | WAITING_HITL | CAPTCHA or verification needed |
| FORM_FILLING | PROCESSING | Forms completed |
| PROCESSING | COMPLETED | Submission confirmed |
| Any | PAUSED | Graceful shutdown signal |
| Any | FAILED_TERMINAL | Retry budget exhausted |

---

## HITL


> **Scope:** [MVP REQUIRED]
When the worker encounters a scenario that cannot be automated (CAPTCHA, verification code, ambiguous form field), it transitions to HITL (Human-in-the-Loop) mode.

### HITL Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              HITL FLOW                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Worker encounters non-automatable step                                          │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: PERSIST CONTEXT PACK                                           │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Capture comprehensive context for the human operator:                  │    │
│  │                                                                         │    │
│  │  • Screenshot: Full-page screenshot of current browser state            │    │
│  │  • HTML Snapshot: DOM structure at the moment                           │    │
│  │  • Job Context: Current state, history, applicant info                  │    │
│  │  • Instructions: What action is needed                                  │    │
│  │                                                                         │    │
│  │  Storage:                                                               │    │
│  │  • Binary data (screenshot, HTML) → Encrypted disk                      │    │
│  │  • References (file paths) → Database                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: TRANSITION TO WAITING_HITL                                     │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Update job.current_state = WAITING_HITL                              │    │
│  │  • Create hitl_tasks record with:                                       │    │
│  │    - job_id                                                             │    │
│  │    - context_ref (path to context pack)                                 │    │
│  │    - expires_at (now + HITL_SLA)                                        │    │
│  │    - status = PENDING                                                   │    │
│  │  • Write job_event: HITL_REQUESTED                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 3: PAUSE EXECUTION                                                │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Release Redis lease (allow other jobs to be picked up)               │    │
│  │  • Close browser session (free resources)                               │    │
│  │  • Worker returns to polling for new jobs                               │    │
│  │                                                                         │    │
│  │  Job waits for human to complete HITL task...                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│       │                     HUMAN COMPLETES TASK                                 │
│       │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 4: JOB RESUMES                                                    │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Job re-enters queue with WAITING_HITL → resumable state              │    │
│  │  • Worker picks up job, re-authenticates if needed                      │    │
│  │  • Reads HITL result from hitl_tasks                                    │    │
│  │  • Continues execution from checkpoint                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### HITL Expiry Handling

| Scenario | Action |
|----------|--------|
| HITL completed before `expires_at` | Job resumes normally |
| `expires_at` reached, retries remaining | Transition to FAILED_RETRYABLE, will retry |
| `expires_at` reached, no retries | Transition to FAILED_TERMINAL (DLQ) |

---

## SIGTERM Handling


> **Scope:** [MVP REQUIRED]
When the worker receives SIGTERM (deployment, scaling, maintenance), it must shut down gracefully without losing work.

### Graceful Shutdown Sequence

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        SIGTERM HANDLING SEQUENCE                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  SIGTERM Received (or SIGINT)                                                    │
│       │                                                                          │
│       │ Signal handler triggered                                                 │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: STOP POLLING                                                   │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Immediately stop accepting new jobs from queue                       │    │
│  │  • Unregister from BullMQ worker pool                                   │    │
│  │  • Set internal "shutting_down" flag                                    │    │
│  │                                                                         │    │
│  │  IMPORTANT: Current job (if any) continues to safe stopping point      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: PERSIST CHECKPOINT                                             │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  If currently processing a job:                                         │    │
│  │  • Complete current atomic action (if possible within timeout)          │    │
│  │  • Save checkpoint with current progress                                │    │
│  │  • Include all state needed for another worker to resume                │    │
│  │                                                                         │    │
│  │  Checkpoint data:                                                       │    │
│  │  • Current FSM state                                                    │    │
│  │  • Collected form data                                                  │    │
│  │  • Any IDs or references from target site                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 3: RELEASE LEASE                                                  │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Delete Redis lease key explicitly                                    │    │
│  │  • Don't wait for TTL to expire naturally                               │    │
│  │  • Allows faster pickup by another worker                               │    │
│  │                                                                         │    │
│  │  Command: DEL job:{job_id}:lease                                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 4: TRANSITION JOB TO PAUSED                                       │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Update job.current_state = PAUSED                                    │    │
│  │  • Write job_event: PAUSED_FOR_SHUTDOWN                                 │    │
│  │  • Update job_runs.ended_at = now()                                     │    │
│  │                                                                         │    │
│  │  PAUSED is a safe parking state:                                        │    │
│  │  • Job is NOT failed                                                    │    │
│  │  • Job will be picked up again when workers restart                     │    │
│  │  • No retry budget consumed                                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 5: EXIT PROCESS                                                   │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Close database connections                                           │    │
│  │  • Close Redis connections                                              │    │
│  │  • Close browser instance (if open)                                     │    │
│  │  • Exit with code 0 (clean exit)                                        │    │
│  │                                                                         │    │
│  │  Container orchestration sees healthy shutdown                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Shutdown Timeout

| Phase | Timeout | Action if Exceeded |
|-------|---------|-------------------|
| Checkpoint persistence | 30 seconds | Force checkpoint with partial data |
| Lease release | 5 seconds | Continue (lease will expire via TTL) |
| Connection cleanup | 10 seconds | Force close |
| **Total** | 45 seconds | Force exit |

---

## Crash Recovery


> **Scope:** [MVP REQUIRED]
When a worker crashes unexpectedly (OOM, hardware failure, network partition), the system automatically recovers.

### Recovery Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CRASH RECOVERY FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Worker crashes (no graceful shutdown)                                           │
│       │                                                                          │
│       │ Lease TTL expires (e.g., 60 seconds)                                     │
│       │ Heartbeat becomes stale                                                  │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STUCK JOB DETECTION                                                    │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Background process periodically checks for:                            │    │
│  │  • Jobs with expired Redis leases                                       │    │
│  │  • Jobs with stale heartbeat_at (> 2× interval)                         │    │
│  │                                                                         │    │
│  │  When detected:                                                         │    │
│  │  • Mark job_runs.status = ABANDONED                                     │    │
│  │  • Write job_event: RUN_ABANDONED                                       │    │
│  │  • Re-enqueue job for pickup                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  NEW WORKER ACQUIRES JOB                                                │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  A healthy worker picks up the job through normal acquisition flow.     │    │
│  │  (See Job Acquisition section)                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  RE-AUTHENTICATE                                                        │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Start fresh browser session                                          │    │
│  │  • Cannot reuse previous session (crashed worker's session is gone)     │    │
│  │  • Perform full login flow on target site                               │    │
│  │  • Validate authentication success                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  RESUME FROM LAST CHECKPOINT                                            │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Load last checkpoint from database                                   │    │
│  │  • Determine current FSM state                                          │    │
│  │  • Load any collected data (form values, IDs)                           │    │
│  │  • Continue execution from that point                                   │    │
│  │                                                                         │    │
│  │  GUARANTEES:                                                            │    │
│  │  • No duplicate actions on target site                                  │    │
│  │  • No lost progress                                                     │    │
│  │  • Full audit trail maintained                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ╔═════════════════════════════════════════════════════════════════════════╗    │
│  ║               JOB CONTINUES NORMAL EXECUTION                            ║    │
│  ╚═════════════════════════════════════════════════════════════════════════╝    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Recovery Scenarios

| Crash Point | Checkpoint State | Recovery Action |
|-------------|------------------|-----------------|
| Before first checkpoint | No checkpoint | Start from beginning |
| During LOGIN_PROCESS | LOGIN_PROCESS | Re-attempt login |
| During FORM_FILLING | Partial form data | Resume form from checkpoint |
| During PROCESSING | Pre-submission | Re-verify and submit |
| After submission, before confirmation | PROCESSING | Verify submission status first |

---

## Lifecycle Diagram


> **Scope:** [MVP REQUIRED]
Complete worker lifecycle from start to shutdown:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        COMPLETE WORKER LIFECYCLE                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                              ┌─────────────┐                                    │
│                              │   START     │                                    │
│                              └──────┬──────┘                                    │
│                                     │                                           │
│                                     ▼                                           │
│                     ┌───────────────────────────────┐                           │
│                     │      STARTUP SEQUENCE         │                           │
│                     │  • Load config & secrets      │                           │
│                     │  • Connect to Redis & DB      │                           │
│                     │  • Register signal handlers   │                           │
│                     └───────────────┬───────────────┘                           │
│                                     │                                           │
│                                     ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                          │  │
│  │  ┌─────────────────────┐     ┌─────────────────────────────────────┐    │  │
│  │  │   POLLING QUEUE     │────▶│        JOB ACQUIRED                 │    │  │
│  │  │   (Idle State)      │     │  • Get lease                        │    │  │
│  │  └─────────────────────┘     │  • Verify state                     │    │  │
│  │           ▲                  │  • Create run                       │    │  │
│  │           │                  └──────────────┬──────────────────────┘    │  │
│  │           │                                 │                           │  │
│  │           │                                 ▼                           │  │
│  │           │                  ┌─────────────────────────────────────┐    │  │
│  │           │                  │       EXECUTION LOOP                │    │  │
│  │           │                  │  ┌─────────────────────────────┐   │    │  │
│  │           │                  │  │ 1. Assert external state    │   │    │  │
│  │           │                  │  │ 2. Execute action           │   │    │  │
│  │           │                  │  │ 3. Persist checkpoint       │   │    │  │
│  │           │                  │  │ 4. Emit event               │   │    │  │
│  │           │                  │  └─────────────────────────────┘   │    │  │
│  │           │                  └──────────────┬──────────────────────┘    │  │
│  │           │                                 │                           │  │
│  │           │              ┌──────────────────┼──────────────────┐        │  │
│  │           │              ▼                  ▼                  ▼        │  │
│  │           │      ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   │  │
│  │           │      │  COMPLETED  │   │    HITL     │   │   FAILED    │   │  │
│  │           │      └──────┬──────┘   └──────┬──────┘   └──────┬──────┘   │  │
│  │           │             │                 │                 │          │  │
│  │           │             │                 │                 │          │  │
│  │           └─────────────┴─────────────────┴─────────────────┘          │  │
│  │                         Release lease, return to polling                │  │
│  │                                                                          │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                     │                                           │
│                                     │ SIGTERM                                   │
│                                     ▼                                           │
│                     ┌───────────────────────────────┐                           │
│                     │    GRACEFUL SHUTDOWN          │                           │
│                     │  • Stop polling               │                           │
│                     │  • Persist checkpoint         │                           │
│                     │  • Release lease              │                           │
│                     │  • Transition to PAUSED       │                           │
│                     └───────────────┬───────────────┘                           │
│                                     │                                           │
│                                     ▼                                           │
│                              ┌─────────────┐                                    │
│                              │    EXIT     │                                    │
│                              │  (Code 0)   │                                    │
│                              └─────────────┘                                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Lease Fencing (Critical Actions)


> **Scope:** [MVP REQUIRED]
To prevent "split-brain" scenarios where two workers accidentally process the same job, the worker **MUST** verify its lease before performing any **critical action**. This is called "lease fencing."

### Critical Actions List (MUST `verifyLease()`)

The following actions are considered **critical** and require lease verification immediately before execution:

| Critical Action | Why It's Critical | Consequence of Double-Execution |
|-----------------|-------------------|--------------------------------|
| **Form Submit** | Submits application to consulate | Duplicate applications, potential bans |
| **Slot Booking Confirm** | Confirms appointment slot | Double-booking, wasted slots |
| **Payment Capture Trigger** | Initiates charge to customer | Duplicate charges |
| **Evidence Pack Seal** | Finalizes billing proof | Corrupted/duplicate evidence |
| **OTP/Captcha Submit (HITL)** | Submits human-provided input | Wasted HITL effort, session invalidation |

### `verifyLease()` Implementation

```typescript
async function verifyLease(jobId: string, workerId: string): Promise<boolean> {
  const leaseKey = `job:${jobId}:lease`;
  const currentLease = await redis.get(leaseKey);
  
  if (!currentLease) {
    logger.warn({ jobId, workerId }, 'Lease expired or missing');
    return false;
  }
  
  const [leaseOwner, timestamp] = currentLease.split(':');
  
  if (leaseOwner !== workerId) {
    logger.error({ jobId, workerId, leaseOwner }, 'Lease stolen by another worker');
    return false;
  }
  
  return true;
}
```

### Critical Action Guard Pattern

```typescript
async function performCriticalAction(
  jobId: string,
  workerId: string,
  action: () => Promise<void>,
  actionName: string
): Promise<void> {
  // MUST verify lease immediately before critical action
  const hasLease = await verifyLease(jobId, workerId);
  
  if (!hasLease) {
    throw new LeaseViolationError(
      `Cannot perform ${actionName}: lease not held for job ${jobId}`
    );
  }
  
  // Perform the critical action
  await action();
  
  // Log successful critical action
  await emitJobEvent(jobId, 'CRITICAL_ACTION_COMPLETED', {
    action: actionName,
    worker_id: workerId,
    timestamp: new Date().toISOString()
  });
}

// Usage example
await performCriticalAction(jobId, workerId, async () => {
  await page.click('#submit-application');
}, 'FORM_SUBMIT');
```

### Lease Fencing Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         LEASE FENCING FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Worker A (has lease)                    Worker B (stale/crashed)               │
│  ────────────────────                    ─────────────────────────              │
│         │                                        │                               │
│         │ About to submit form                   │ Recovers, thinks it has job   │
│         ▼                                        ▼                               │
│  ┌─────────────────┐                      ┌─────────────────┐                   │
│  │ verifyLease()   │                      │ verifyLease()   │                   │
│  │ job:123:lease   │                      │ job:123:lease   │                   │
│  └────────┬────────┘                      └────────┬────────┘                   │
│           │                                        │                            │
│           ▼                                        ▼                            │
│  ┌─────────────────┐                      ┌─────────────────┐                   │
│  │ Lease: WorkerA  │                      │ Lease: WorkerA  │                   │
│  │ ✅ I own it     │                      │ ❌ NOT mine!    │                   │
│  └────────┬────────┘                      └────────┬────────┘                   │
│           │                                        │                            │
│           ▼                                        ▼                            │
│  ┌─────────────────┐                      ┌─────────────────┐                   │
│  │ PROCEED with    │                      │ ABORT action    │                   │
│  │ form submit     │                      │ Release job     │                   │
│  └─────────────────┘                      └─────────────────┘                   │
│                                                                                  │
│  Result: Only ONE worker submits the form. Split-brain prevented.               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Proxy Session Failover


> **Scope:** [MVP REQUIRED]
When a worker is processing a job with a bound proxy session, the proxy may fail mid-execution (IP rotation, provider outage, ban). This section defines the failover policy.

### Proxy Failure Scenarios

| Scenario | Detection | Default Policy |
|----------|-----------|----------------|
| **Proxy Connection Lost** | HTTP timeout, connection refused | Retry with same session (3 attempts) |
| **IP Rotated by Provider** | `last_good_ip` mismatch on resume | Mark `FAILED_PROXY_LOST` |
| **Proxy Session Expired** | Provider returns session invalid | Mark `FAILED_PROXY_LOST` |
| **IP Banned by Target** | Target returns 403/captcha wall | Escalate to `WAITING_HITL` or `FAILED_RETRYABLE` |

### `FAILED_PROXY_LOST` State

This is a special failure state indicating the job failed due to proxy loss, not application logic. It requires different handling than generic retries.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      PROXY FAILOVER FLOW                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Worker executing job with proxy session                                        │
│         │                                                                        │
│         ▼                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Proxy connection fails / IP changes                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│         │                                                                        │
│         ▼                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: ATTEMPT SAME-SESSION RECONNECT (up to 3 times)                 │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Request proxy provider to re-establish session                       │    │
│  │  • Verify egress IP matches `last_good_ip` (if critical)                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│         │                                                                        │
│         ├──────────────────────────────────────────────────────────────────┐    │
│         │ Success                                                          │    │
│         ▼                                                                  │    │
│  ┌──────────────────┐                                                      │    │
│  │ Continue job     │                                                      │    │
│  │ (same session)   │                                                      │    │
│  └──────────────────┘                                                      │    │
│                                                                             │    │
│         │ Reconnect failed                                                  │    │
│         ▼                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: CHECK POLICY - Can we use new proxy?                           │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Policy options (configured per tenant/job type):                       │    │
│  │                                                                         │    │
│  │  • STRICT: Proxy session is critical → FAILED_PROXY_LOST               │    │
│  │  • LENIENT: Try new proxy + re-authenticate → FAILED_RETRYABLE          │    │
│  │  • HITL: Escalate to human for decision → WAITING_HITL                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│         │                                                                        │
│         ├─────────────────────┬─────────────────────┐                           │
│         ▼                     ▼                     ▼                           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │
│  │ FAILED_PROXY_LOST│  │ FAILED_RETRYABLE │  │  WAITING_HITL    │              │
│  │ (needs manual    │  │ (auto-retry with │  │ (human decides   │              │
│  │  intervention)   │  │  new proxy)      │  │  next step)      │              │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```



### Ban / Rate-Limit Auto Pause

If the system detects:
- many consecutive 403/429
- captcha walls repeatedly
- request failures spike

Then:
- automatically pause portal intake
- stop assigning new jobs
- notify admin

Purpose:
Prevent IP burn and protect proxy pool.

### Proxy Failover Configuration

```typescript
interface ProxyFailoverPolicy {
  // Number of reconnect attempts before declaring failure
  maxReconnectAttempts: number; // default: 3
  
  // Delay between reconnect attempts (exponential backoff)
  reconnectBackoffMs: number; // default: 1000
  
  // Policy when reconnect fails
  failurePolicy: 'STRICT' | 'LENIENT' | 'HITL'; // default: 'STRICT'
  
  // Whether IP must match last_good_ip
  requireSameIP: boolean; // default: true for vize sites
}

// Default policy for visa automation (conservative)
const DEFAULT_PROXY_POLICY: ProxyFailoverPolicy = {
  maxReconnectAttempts: 3,
  reconnectBackoffMs: 1000,
  failurePolicy: 'STRICT',
  requireSameIP: true
};
```

### Proxy State Checkpoint

When proxy state changes, the worker **MUST** update the checkpoint:

```typescript
// After successful proxy connection
await updateJobCurrentState(jobId, {
  proxy_session: {
    id: proxySession.id,
    provider: proxySession.provider,
    last_good_ip: await getEgressIP(),
    expires_at: proxySession.expiresAt,
    connected_at: new Date().toISOString()
  }
});

// After proxy failure (before state transition)
await emitJobEvent(jobId, 'PROXY_LOST', {
  session_id: currentState.proxy_session.id,
  last_good_ip: currentState.proxy_session.last_good_ip,
  failure_reason: error.message,
  reconnect_attempts: attemptCount
});
```

---

## Testing Strategy

### Selector Testing (Legal-Safe Approach)

**Principle:** Test automation logic without copying target sites.

#### 1. Fixture Testing
Create minimal HTML fixtures with required elements:
- Form elements: `#apForm`, `#NationalityTabID`, `#AppointmentTabID`
- Date/time inputs: `#TravelDate`, `#datepicker`, `#AppointmentTime`
- Applicant fields: `PassportNumber`, `Name`, `Surname`
- UI elements: `#AppTime`, `.custom-loader-wrap`, `.appointment-form-wrapper`

**Important:** Do NOT include Cloudflare/Turnstile scripts (won't work in CI anyway).

#### 2. Mock API Contract
Mirror backend endpoints based on observed behavior:
```
POST /AnBir/Macaristan/TarihGetir → returns date list
POST /AnBir/Macaristan/SaatGetir → returns [{ value, text }]
```

Mock server returns identical JSON shapes for testing.

#### 3. CI Test Layers

**Selector Unit Tests:**
- Verify selectors exist on fixture page
- Test element presence, not behavior

**Flow Unit Tests:**
- Nationality select → AppointmentTab change
- Date endpoint called → datepicker populated
- Time endpoint called → AppointmentTime filled

**Integration Tests:**
- Full FSM flow with mocked backend
- State transitions verified
- Checkpoint data validated

#### 4. Smoke Tests (Production)
**Low-frequency, non-invasive checks:**
- Page loads successfully
- Form elements present
- Dates endpoint returns data (log only)

**Safety measures:**
- Strict pacing + retry/backoff
- Circuit breaker on errors (5xx/403 → cooldown)
- No aggressive polling

### Watcher Design (Slot Detection)

**Goal:** Detect availability without aggressive automation.

**Approach:**
- Periodic checks with jitter (30-90s intervals)
- Check date availability via UI or API response
- Hash slot set for change detection
- Fire SLOT_FOUND event when new slots appear

**Not a booking trigger:**
- Watcher only detects availability
- Separate booking job can be queued
- HITL approval recommended for operational safety

---

## Related Documents

- [Evidence Finalization](../business/VISA_EVIDENCE_FINALIZATION.md) — `FINALIZING` state and evidence sealing
- [Database Schema](../database/VISA_DATABASE_SCHEMA.md) — `proxy_session` fields in `current_state`
- [SaaS Architecture](../architecture/VISA_SAAS_ARCHITECTURE.md) — Proxy session binding contract
- [Production Runbook](../operations/VISA_PRODUCTION_RUNBOOK.md) — Handling proxy-related incidents


---

## Agent Pools & Portal Policies

> **Scope:** [MVP REQUIRED]

Workers are treated as **Agents** and are not interchangeable across portals.

### Agent Assignment
- Each agent has `assigned_portal_ids`
- Agent only pulls jobs for its assigned portals

### Portal Policy (per portal)
- mode: `SERIAL` | `PARALLEL`
- max_concurrency: integer
- optional request budgets (rpm/rph)
- circuit breaker (auto pause on many 403/429)

### Scheduling Rules
- SERIAL → only 1 active agent (anti-ban mode)
- PARALLEL → up to N agents
- Circuit breaker → auto pause portal queue if block suspected

Purpose:
- Reduce IP bans
- Control load
- Safe scaling per portal
