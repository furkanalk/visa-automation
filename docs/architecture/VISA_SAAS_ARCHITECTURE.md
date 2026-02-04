# Visa Application Automation SaaS

## Scope Labels

This document is the **reference architecture**. It contains both MVP and forward-looking hardening items.

- **[MVP REQUIRED]** → required for the first production pilot
- **[PHASED / LATER]** → planned for later phases; keep as design reference
- **[OPS]** → operational guidance, sizing, or runbooks (does not block MVP)

This file is **not** a checklist; execution steps live in the execution roadmap/checklist.

---
## Final Locked Architecture Specification

> **Document Status:** Final, Locked  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Technology Stack](../architecture/VISA_SAAS_TECHNOLOGY_AND_SYSTEMS.md) | [Worker Lifecycle](../architecture/VISA_WORKER_LIFECYCLE.md) | [Database Schema](../database/VISA_DATABASE_SCHEMA.md) | [API Contract](../api/VISA_CORE_API_CONTRACT.md) | [Security Model](../security/VISA_SECURITY_MODEL.md) | [Data Protection](../security/VISA_DATA_PROTECTION.md) | [Cost Estimation](../business/VISA_COST_ESTIMATION.md) | [DB Operational Guards](../database/VISA_DATABASE_OPERATIONAL_GUARDS.md) | [Evidence Finalization](../business/VISA_EVIDENCE_FINALIZATION.md) | [Payments Lifecycle](../business/VISA_PAYMENTS_LIFECYCLE.md)

---

## Table of Contents

1. [Purpose and Scope](#0-purpose-and-scope)
2. [Vision: Deterministic & Resilient Automation](#1-vision-deterministic--resilient-automation)
3. [Finite State Machine (FSM)](#2-finite-state-machine-fsm)
4. [Worker Lifecycle & Queue Hygiene](#3-worker-lifecycle--queue-hygiene)
5. [HITL (Human-in-the-Loop)](#4-hitl-human-in-the-loop)
6. [Capacity, Backpressure & Starvation Protection](#5-capacity-backpressure--starvation-protection)
7. [Observability](#6-observability-cloud-hosted)
8. [API Contract & Security](#7-api-contract--security)
9. [Data & Migrations](#8-data--migrations)
10. [Secrets Management](#9-secrets-management)
11. [Infrastructure as Code](#10-infrastructure-as-code-terraform)
12. [Edge Gateway](#11-edge-gateway-kong-oss)
13. [CI/CD & Environments](#12-cicd--environments)
14. [Disaster Recovery & Incident Modes](#13-disaster-recovery--incident-modes)
15. [Security Hardening](#14-hardening-mandatory)
16. [Production Sizing](#15-baseline-production-sizing)
17. [Customer Visibility, Billing Proof & Notifications](#16-customer-visibility-billing-proof--notifications)
18. [Database Growth Strategy](#18-database-growth-retention--partitioning-strategy)

---

## 0. Purpose and Scope

> **Scope:** [MVP REQUIRED]

This document defines the **final, locked architecture specification** for a commercial, high-volume, fault-tolerant **Visa Application Automation System (SaaS)** built for the logistics domain.

### What This Document Covers

This specification explicitly defines:

| Aspect | Description |
|--------|-------------|
| **Technologies** | What technologies are used and their specific roles |
| **Rationale** | Why each technology was chosen over alternatives |
| **Operations** | How the system is deployed, monitored, and maintained |
| **Failure Handling** | How worst-case scenarios are detected, handled, and recovered |

### Architectural Stability Commitment

From this point forward, **architectural pivots are not expected**. Only the following changes are permitted:

- ✅ Performance optimizations within the existing architecture
- ✅ Bug fixes and security patches
- ✅ Configuration tuning
- ❌ Technology replacements
- ❌ Fundamental design changes

---

## 1. Vision: Deterministic & Resilient Automation

> **Scope:** [MVP REQUIRED]

### 1.1 Core Principles

The architecture is built on five foundational principles that address the unique challenges of automating interactions with external visa application systems:

| Principle | Rationale | Implementation |
|-----------|-----------|----------------|
| **Target Volatility** | Target systems are volatile—sessions expire, state is unreliable | Never trust session persistence; validate state continuously |
| **Replayability** | All progress must be auditable and resumable | Checkpoint after every critical step |
| **Determinism** | Same inputs must produce same outputs | Idempotent operations, explicit state machine |
| **Browser-Bound Scaling** | Scaling is limited by browser memory, not CPU | Worker count determined by available RAM |
| **Single-Server Constraint** | Production runs on a single server | Simplicity over distributed complexity |

### 1.2 Core Flow

The system follows a linear, well-defined flow from user request to target site interaction:

```
┌──────────┐    ┌─────────────────┐    ┌────────────┐    ┌───────────────────┐    ┌─────────────────┐    ┌─────────────┐
│    UI    │───▶│       API       │───▶│ PostgreSQL │───▶│  Queue (BullMQ)   │───▶│ Worker (Lease)  │───▶│ Target Site │
│          │    │  (Backpressure) │    │            │    │                   │    │                 │    │             │
└──────────┘    └─────────────────┘    └────────────┘    └───────────────────┘    └─────────────────┘    └─────────────┘
                       │                      ▲                                            │
                       │                      │                                            │
                       │                      └────────── Checkpoints & Events ────────────┘
```

**Flow Breakdown:**

1. **UI → API**: User submits visa application request
2. **API → PostgreSQL**: Request validated, job created with initial state
3. **PostgreSQL → Queue**: Job enqueued for processing with priority
4. **Queue → Worker**: Worker acquires lease and begins processing
5. **Worker → Target Site**: Automated browser interacts with visa portal
6. **Worker → PostgreSQL**: Progress checkpointed after each step

### 1.3 Deterministic Resume

Workers checkpoint progress after every critical step, enabling recovery from any failure:

**Resume Process:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CRASH / RESTART / SESSION LOSS                          │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Step 1: NEW WORKER ACQUIRES JOB                                                │
│  - Obtains exclusive lease from Redis                                           │
│  - Loads last checkpoint from PostgreSQL                                        │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Step 2: RE-AUTHENTICATE                                                        │
│  - Start fresh browser session                                                  │
│  - Perform login flow on target site                                            │
│  - Validate authentication success                                              │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Step 3: VALIDATE EXTERNAL STATE                                                │
│  - Query target site for current application state                              │
│  - Compare with checkpoint expectations                                         │
│  - Resolve any discrepancies                                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Step 4: DETERMINISTIC RESUME                                                   │
│  - Jump to last completed checkpoint                                            │
│  - Continue execution from that point                                           │
│  - No duplicate work performed                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 Proxy Session Binding (MUST)

Target visa sites often employ IP-based session validation and anti-automation measures. To ensure deterministic resume works correctly, **proxy session continuity is MANDATORY**.

#### Contract Requirements

| Requirement | Level | Description |
|-------------|-------|-------------|
| **Proxy Session ID Persistence** | MUST | Each job MUST store `proxy_session_id` in checkpoint |
| **Same Proxy on Resume** | MUST | Worker MUST use identical proxy session when resuming |
| **Proxy Provider Tracking** | MUST | `proxy_provider` MUST be stored for provider failover logic |
| **Last Known IP** | SHOULD | `last_good_ip` SHOULD be stored for debugging/validation |

#### Job Payload Proxy Fields

The following fields MUST be stored in job checkpoint (`current_state` JSONB):

```json
{
  "proxy_session": {
    "proxy_session_id": "sess_abc123xyz",
    "proxy_provider": "provider_name",
    "last_good_ip": "203.0.113.42",
    "session_created_at": "2026-01-25T10:00:00Z",
    "session_expires_at": "2026-01-25T22:00:00Z"
  }
}
```

#### Resume Proxy Binding Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        PROXY SESSION BINDING ON RESUME                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Worker acquires job for resume                                                  │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Load proxy_session from checkpoint                                     │    │
│  │  • proxy_session_id: "sess_abc123xyz"                                   │    │
│  │  • proxy_provider: "provider_name"                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Is session still valid? (not expired, provider available)              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ├─── YES ──▶ Bind to SAME proxy session                                   │
│       │            Continue with deterministic resume                            │
│       │                                                                          │
│       └─── NO ───▶ Allocate NEW proxy session                                   │
│                    Update checkpoint with new session                            │
│                    Trigger NEEDS_REAUTH (session change = re-login required)    │
│                                                                                  │
│  CRITICAL: IP change during active session may trigger target site security     │
│            Always attempt to maintain proxy session continuity                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Why This Matters

| Scenario | Without Proxy Binding | With Proxy Binding |
|----------|----------------------|-------------------|
| Worker crash mid-session | New IP → Session invalid → Re-login fails → Job fails | Same IP → Session valid → Resume succeeds |
| Target site IP check | IP mismatch detected → Account flagged | Consistent IP → No flags |
| Debugging failures | No IP context in logs | Full proxy context for forensics |

---

## 2. Finite State Machine (FSM)

The FSM defines every possible state a job can be in and the valid transitions between states. This ensures predictable behavior and simplifies debugging.

### 2.1 State Diagram

```
                                    ┌─────────────────────────────────────────────────────────────────┐
                                    │                      HAPPY PATH                                  │
                                    └─────────────────────────────────────────────────────────────────┘

┌─────────┐    ┌────────┐    ┌───────────────┐    ┌───────────┐    ┌──────────────┐    ┌────────────┐    ┌───────────┐
│ DRAFTED │───▶│ QUEUED │───▶│ LOGIN_PROCESS │───▶│ LOGGED_IN │───▶│ FORM_FILLING │───▶│ PROCESSING │───▶│ COMPLETED │
└─────────┘    └────────┘    └───────────────┘    └───────────┘    └──────────────┘    └────────────┘    └───────────┘
                                    │                   │                 │                  │
                                    │                   │                 │                  │
                                    ▼                   ▼                 ▼                  ▼
                              ┌──────────┐        ┌──────────┐      ┌──────────────┐   ┌──────────────────┐
                              │  PAUSED  │◀───────│  PAUSED  │◀─────│ WAITING_HITL │   │ FAILED_RETRYABLE │
                              └──────────┘        └──────────┘      └──────────────┘   └──────────────────┘
                                    │                   │                 │                  │
                                    │                   │                 │                  │
                                    └───────────────────┴─────────────────┴──────────────────┤
                                                                                            ▼
                                                                                   ┌─────────────────┐
                                                                                   │ FAILED_TERMINAL │
                                                                                   │      (DLQ)      │
                                                                                   └─────────────────┘
```

### 2.2 State Definitions

| State | Description | Entry Conditions | Exit Conditions |
|-------|-------------|------------------|-----------------|
| **DRAFTED** | Job created but not yet submitted for processing | User saves application draft | User submits job for processing |
| **QUEUED** | Job waiting in queue for worker pickup | Job submitted, passes admission control | Worker acquires job lease |
| **LOGIN_PROCESS** | Worker attempting to authenticate with target site | Worker begins job execution | Login succeeds or fails |
| **LOGGED_IN** | Successfully authenticated, ready for form work | Login validation passes | Begin form filling |
| **FORM_FILLING** | Actively filling application forms | Authentication confirmed | Form completion or HITL needed |
| **PAUSED** | Safe parking state for graceful handling | Graceful shutdown, manual stop, incident mode | Resume signal received |
| **WAITING_HITL** | Human intervention required (CAPTCHA, verification, etc.) | Non-automatable step encountered | Human completes task or timeout |
| **PROCESSING** | Final submission and confirmation phase | Forms completed successfully | Submission confirmed |
| **COMPLETED** | Job finished successfully | Target site confirms submission | Terminal state |
| **FAILED_RETRYABLE** | Temporary failure, retry budget available | Transient error, retries remaining | Auto-retry or manual intervention |
| **FAILED_PROXY_LOST** | Proxy session lost mid-execution | Proxy connection failed, IP changed | Policy-driven: re-auth or terminal |
| **FAILED_TERMINAL** | Permanent failure, requires manual intervention (DLQ) | Retry budget exhausted, unrecoverable error | Manual requeue or cancellation |

### 2.3 External Assertions

At every state transition and resume, the worker **asserts external reality** before proceeding:

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL ASSERTION FLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Before Each State Transition:                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  1. Query external system state                          │    │
│  │  2. Compare with expected state                          │    │
│  │  3. If mismatch:                                         │    │
│  │     - DO NOT fail the job immediately                    │    │
│  │     - Trigger NEEDS_REAUTH state                         │    │
│  │     - Attempt recovery before failure                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Example Assertions:                                             │
│  • "Am I still authenticated?" (check session validity)          │
│  • "Is the form still on the expected page?"                     │
│  • "Has my previous submission been received?"                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Why This Matters:**
- Target sites can invalidate sessions unexpectedly
- Network issues may cause silent disconnections
- Assertions catch problems before they cause data corruption

---

## 3. Worker Lifecycle & Queue Hygiene

> **Scope:** [MVP REQUIRED]

> **Detailed Documentation:** See [VISA_WORKER_LIFECYCLE.md](../architecture/VISA_WORKER_LIFECYCLE.md)

### 3.1 Lease & Ownership

Jobs are processed with exclusive ownership to prevent duplicate processing:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           LEASE ACQUISITION FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌───────────┐         ┌───────────┐         ┌─────────────────────────────┐   │
│  │  Worker   │──GET───▶│   Redis   │──CHECK──▶│  Lease Available?           │   │
│  │           │  LEASE  │           │          │  • No existing lease         │   │
│  │           │         │           │          │  • Previous lease expired    │   │
│  └───────────┘         └───────────┘          └─────────────────────────────┘   │
│       │                      │                              │                    │
│       │                      │                      ┌───────┴───────┐            │
│       │                      │                      ▼               ▼            │
│       │                      │                    [YES]           [NO]           │
│       │                      │                      │               │            │
│       │                      │                      ▼               ▼            │
│       │                      │              ┌─────────────┐  ┌─────────────┐    │
│       │                      │              │ Grant Lease │  │ Reject/Wait │    │
│       │                      │              │ Set TTL     │  │             │    │
│       │                      │              └─────────────┘  └─────────────┘    │
│       │                      │                                                   │
└───────┴──────────────────────┴───────────────────────────────────────────────────┘

GUARANTEES:
• Only ONE worker can hold a lease for a given job
• Split-brain execution is IMPOSSIBLE by design
• Heartbeat extends lease TTL during processing
```

**Lease Properties:**
- Redis-based distributed lock
- TTL-based automatic expiration
- Mandatory heartbeat to maintain lease
- Split-brain execution is architecturally impossible

### 3.2 Graceful Shutdown

When a worker receives SIGTERM (deployment, scaling, maintenance), it follows this sequence:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          SIGTERM HANDLING SEQUENCE                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  SIGTERM Received                                                                │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: STOP ACCEPTING NEW JOBS                                        │    │
│  │  • Unregister from queue polling                                        │    │
│  │  • No new work will be picked up                                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: PERSIST CHECKPOINT                                             │    │
│  │  • Save current progress to PostgreSQL                                  │    │
│  │  • Include all state needed for resume                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 3: RELEASE LEASE SAFELY                                           │    │
│  │  • Delete Redis lease key                                               │    │
│  │  • Allow other workers to acquire job                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 4: TRANSITION JOB TO PAUSED                                       │    │
│  │  • Job state = PAUSED (not FAILED)                                      │    │
│  │  • Job remains resumable                                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 5: EXIT PROCESS                                                   │    │
│  │  • Clean exit code (0)                                                  │    │
│  │  • Container orchestration sees healthy shutdown                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Stuck Job Detection

The system detects and recovers from stuck jobs using dual verification:

| Detection Method | Mechanism | Threshold | Action |
|------------------|-----------|-----------|--------|
| **Redis TTL** | Lease expires automatically | Configurable TTL | Job becomes available for pickup |
| **DB Heartbeat** | `heartbeat_at` timestamp in `job_runs` | 2x heartbeat interval | Mark run as ABANDONED |

**Recovery Flow:**
1. Stuck job detected (lease expired + heartbeat stale)
2. Run marked as ABANDONED in database
3. Job becomes eligible for new worker pickup
4. New worker resumes from last checkpoint

### 3.4 Retry & DLQ (Dead Letter Queue)

The system enforces strict retry policies to prevent infinite loops:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              RETRY POLICY                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ╔═════════════════════════════════════════════════════════════════════════╗    │
│  ║  RULE: Infinite retries are FORBIDDEN                                   ║    │
│  ╚═════════════════════════════════════════════════════════════════════════╝    │
│                                                                                  │
│  Retry Budget:                                                                   │
│  • Each job has a maximum retry count (configurable per tenant)                 │
│  • Each retry attempt is logged in job_events                                   │
│  • Exponential backoff between retries                                          │
│                                                                                  │
│  When Retry Budget Exhausted:                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐        │
│  │  Job transitions to FAILED_TERMINAL                                 │        │
│  │  • Job enters Dead Letter Queue (DLQ)                               │        │
│  │  • Alert sent to operations team                                    │        │
│  │  • Requires EXPLICIT manual requeue to retry                        │        │
│  └─────────────────────────────────────────────────────────────────────┘        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---


### 3.5 Agent Pools & Portal Policies (Operational Control)

To safely run multiple visa portals and control ban/rate-limit risk, workers are treated as **Agents**.

**Agent assignment**
- Each agent has `assigned_portal_ids` (e.g., `idata-ita`, `as-visa-ankara`)
- Agents only pull jobs for assigned portals

**Portal policy (per portal)**
- `mode`: `SERIAL` (only 1 active agent) or `PARALLEL` (up to N concurrent agents)
- `max_concurrency`: upper bound for parallel mode
- (optional) `request_budget`: rpm/rph
- (optional) `circuit_breaker`: thresholds for auto-pause on 403/429 spikes

**Enforcement**
- `SERIAL` overrides any agent count → effective concurrency is 1
- Circuit breaker may transition portal processing to paused/incident mode until reviewed


## 4. HITL (Human-in-the-Loop)

Human-in-the-Loop (HITL) handles scenarios that cannot be automated, such as CAPTCHAs, verification codes, or ambiguous form fields.

### 4.1 Context Pack

When HITL is triggered, the system captures comprehensive context for the human operator:

| Component | Description | Storage |
|-----------|-------------|---------|
| **Screenshot** | Full-page screenshot of current state | Encrypted disk |
| **HTML Snapshot** | DOM structure at the moment of pause | Encrypted disk |
| **Job Context** | Current state, history, applicant info | Database reference |
| **Instructions** | What action is needed from operator | HITL task record |

**Storage Strategy:**
- Binary data (screenshots, HTML) stored on encrypted disk
- Only **references** (file paths) stored in database
- Reduces database bloat while maintaining audit trail

### 4.2 SLA & Expiry

HITL tasks have time limits to prevent indefinite blocking:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              HITL LIFECYCLE                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Job encounters HITL scenario                                                    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  HITL Task Created                                                      │    │
│  │  • expires_at = now() + HITL_SLA_DURATION                              │    │
│  │  • Context pack saved                                                   │    │
│  │  • Operator notified                                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ├──────────────────────────────────────┐                                   │
│       ▼                                      ▼                                   │
│  [Operator Completes]               [expires_at Reached]                         │
│       │                                      │                                   │
│       ▼                                      ▼                                   │
│  Job Resumes                        ┌─────────────────────────────────────┐     │
│  from WAITING_HITL                  │  Expiry Handling:                   │     │
│                                     │  • If retries remain → FAILED_RETRYABLE │ │
│                                     │  • If no retries → FAILED_TERMINAL  │     │
│                                     └─────────────────────────────────────┘     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 RBAC (Role-Based Access Control)

| Role | Permissions | Use Case |
|------|-------------|----------|
| **Operator** | Handle HITL tasks, view job status | Day-to-day HITL resolution |
| **Admin** | All Operator permissions + override states, force requeue, manage tenants | Incident response, system management |
| **Customer** | Read-only visibility of their own jobs | Self-service status checking |
| **Viewer (Staff)** | **Strictly read-only** dashboards/job views | Office staff who must observe but not act |

---

## 5. Capacity, Backpressure & Starvation Protection

> **Scope:** [MVP REQUIRED]

### 5.1 Admission Control

The API prevents system overload through multi-level admission control:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          ADMISSION CONTROL FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Incoming Request                                                                │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  CHECK 1: Global System Capacity                                        │    │
│  │  • Is total queue depth below maximum?                                  │    │
│  │  • Are workers healthy and processing?                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ├─── FAIL ──▶ HTTP 503 Service Unavailable                                │
│       │             + Retry-After header                                         │
│       │                                                                          │
│       ▼ PASS                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  CHECK 2: Tenant Quota                                                  │    │
│  │  • Is tenant below daily_quota?                                         │    │
│  │  • Is tenant below max_concurrent_jobs?                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ├─── FAIL ──▶ HTTP 429 Too Many Requests                                  │
│       │             + quota reset time                                           │
│       │                                                                          │
│       ▼ PASS                                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ACCEPT REQUEST                                                         │    │
│  │  • If near capacity: HTTP 202 Accepted                                  │    │
│  │    + estimated_start_at in response                                     │    │
│  │  • If capacity available: HTTP 201 Created                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Browser-Bound Scaling

The primary scaling constraint is browser memory, not CPU:

| Resource | Constraint | Implication |
|----------|------------|-------------|
| **RAM** | ~500MB-1GB per browser instance | Directly limits concurrent workers |
| **CPU** | Minimal during wait states | Not the bottleneck |
| **Network** | Dependent on target site | Rate limiting may apply |

**Configuration:**
- `max_concurrent_workers` is **fixed per deployment**
- Queue acts as a **buffer only**, not a scaling mechanism
- Adding capacity requires increasing server resources

### 5.3 Starvation Guard

Prevents low-priority jobs from being indefinitely delayed by VIP jobs:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          STARVATION PREVENTION                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Queue Processing Order:                                                         │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Normal Operation:                                                      │    │
│  │  • VIP jobs processed first (highest priority)                          │    │
│  │  • Standard jobs processed when no VIP jobs waiting                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Starvation Guard (Configurable):                                       │    │
│  │  • After every N VIP jobs, ONE standard job is forced through           │    │
│  │  • Ensures standard jobs make progress even under VIP load              │    │
│  │  • Default: N = 10 (one standard job per 10 VIP jobs)                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Observability (Cloud-Hosted)

### 6.1 Rationale

Observability tools (Prometheus, Grafana, Loki) are RAM-intensive. On a single-server deployment where RAM is reserved for browser workers, running observability locally would reduce processing capacity.

**Decision:** Host observability stack externally (cloud or dedicated VM).

### 6.2 Stack

| Component | Purpose | Deployment |
|-----------|---------|------------|
| **Prometheus** | Metrics collection | Remote write to cloud backend |
| **Loki** | Log aggregation | Remote log shipping |
| **OpenTelemetry** | Distributed tracing | Trace export to backend |
| **Grafana** | Dashboards & Alerting | Grafana Cloud or dedicated VM |

### 6.3 Mandatory Telemetry

Every job and operation must include these correlation IDs:

| Field | Description | Used For |
|-------|-------------|----------|
| `tenant_id` | Customer identifier | Multi-tenant filtering |
| `job_id` | Unique job identifier | Job-level debugging |
| `run_id` | Unique execution attempt | Debugging retries |
| `state` | Current FSM state | State transition tracking |

**Required Metrics:**
- FSM transitions (append-only log)
- Queue depth by tenant and priority
- HITL wait time distribution
- Retry counts by failure reason

> **Detailed Dashboard Configuration:** See [VISA_GRAFANA_DASHBOARDS.md](../operations/VISA_GRAFANA_DASHBOARDS.md)

---


### 6.4 Portal Canary Monitoring (Change Detection)

Because visa portals change their UI/DOM without notice, run **canary jobs** per portal on a schedule (e.g., every 30–60 minutes):

- Canary performs a minimal flow (reach key pages, validate critical selectors)
- If mismatch beyond threshold → emit `portal.change_detected`
- Notify admins (email/webhook) with `diff_summary` + screenshot artifact link

Purpose:
- Detect breakages early
- Trigger adapter redesign before production jobs fail


## 7. API Contract & Security

> **Scope:** [MVP REQUIRED]

### 7.1 Authentication

All API access is strictly controlled:

| Requirement | Implementation |
|-------------|----------------|
| **Tenant-Bound** | Every request must include valid tenant credentials |
| **No Anonymous Access** | Unauthenticated job enqueue is impossible |
| **Token-Based** | JWT tokens with short expiration |
| **Scope Enforcement** | Tenants can only access their own data |

### 7.2 API Idempotency

Prevents duplicate job creation from network issues or client retries:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          IDEMPOTENCY HANDLING                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Job Creation Request:                                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  POST /api/jobs                                                         │    │
│  │  Headers:                                                               │    │
│  │    Idempotency-Key: <client-generated-uuid>    ◀── REQUIRED             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  Server Behavior:                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Check if Idempotency-Key exists in recent requests                  │    │
│  │  2. If EXISTS: Return previous response (no new job created)            │    │
│  │  3. If NEW: Process request, store key with response                    │    │
│  │  4. Keys expire after 24 hours                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  Result: UI retries NEVER create duplicate jobs                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Data & Migrations

> **Scope:** [MVP REQUIRED]

### 8.1 Core Tables

| Table | Purpose | Key Characteristics |
|-------|---------|---------------------|
| `tenants` | Customer/organization records | Quotas, configuration |
| `jobs` | Individual visa applications | FSM state, priority |
| `job_runs` | Execution attempts per job | Lease tracking, heartbeats |
| `hitl_tasks` | Human intervention requests | SLA tracking, context refs |
| `job_events` | Append-only audit log | Immutable history, partitioned |

> **Detailed Schema:** See [VISA_DATABASE_SCHEMA.md](../database/VISA_DATABASE_SCHEMA.md)

### 8.2 Migration Policy

| Rule | Description |
|------|-------------|
| **Forward-Only** | No rollback migrations; fix forward |
| **Backward-Compatible FSM** | New states can be added; existing states never removed without deprecation period |
| **Production Gates** | All migrations require explicit approval before production deployment |
| **Expand-Contract** | Schema changes deployed in two phases to support zero-downtime |

---

## 9. Secrets Management

> **Scope:** [MVP REQUIRED]

### 9.1 Chosen Approach: Docker Secrets

Docker Secrets is optimal for single-server Docker Compose deployments:

| Feature | Docker Secrets |
|---------|----------------|
| **Mounting** | Secrets mounted via `*_FILE` environment variables |
| **Encryption** | Encrypted at rest on disk |
| **Access Control** | Only specified services can access each secret |
| **Rotation** | Supported via secret versioning |

**Example Usage:**
```yaml
services:
  api:
    secrets:
      - db_password
    environment:
      - DB_PASSWORD_FILE=/run/secrets/db_password
```

### 9.2 Alternatives Considered

| Alternative | Reason Not Chosen |
|-------------|-------------------|
| **HashiCorp Vault OSS** | Operational overkill for single-server; requires dedicated infrastructure |
| **SOPS + age** | Poor runtime ergonomics; secrets decrypted at deploy time, not runtime |
| **Kubernetes Secrets** | No Kubernetes in this architecture |

---

## 10. Infrastructure as Code (Terraform)

Terraform manages all cloud infrastructure to ensure reproducibility and prevent drift.

### Managed Resources

| Resource Type | Examples |
|---------------|----------|
| **Compute** | VM instances, instance types |
| **Storage** | Block storage volumes, object storage buckets |
| **Networking** | VPCs, subnets, security groups, firewall rules |
| **DNS** | Domain records, SSL certificates |
| **Object Storage** | Archive buckets for cold data |

### Benefits

| Benefit | Description |
|---------|-------------|
| **Drift Prevention** | Actual state always matches declared state |
| **Reproducibility** | Identical environments from same configuration |
| **CI/CD Integration** | Infrastructure changes go through same review process as code |
| **Disaster Recovery** | Entire infrastructure can be recreated from code |

---

## 11. Edge Gateway (Kong OSS)

### 11.1 Responsibilities

Kong serves as the single entry point for all external traffic:

| Function | Description |
|----------|-------------|
| **TLS Termination** | Handles HTTPS, manages certificates |
| **Authentication** | Validates JWT tokens, enforces tenant context |
| **Authorization** | RBAC enforcement at gateway level |
| **Rate Limiting** | Per-tenant and global rate limits |
| **Request Size Limits** | Prevents oversized payload attacks |

### 11.2 Security

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              KONG SECURITY MODEL                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                          INTERNET                                                │
│                              │                                                   │
│                              ▼                                                   │
│                    ┌─────────────────┐                                          │
│                    │   Kong Gateway  │◀── TLS, Auth, Rate Limiting              │
│                    │   (Port 443)    │                                          │
│                    └────────┬────────┘                                          │
│                             │                                                    │
│  ╔══════════════════════════╪════════════════════════════════════════════════╗  │
│  ║              INTERNAL NETWORK (Never Exposed)                             ║  │
│  ║                          │                                                ║  │
│  ║             ┌────────────┼────────────┐                                   ║  │
│  ║             ▼            ▼            ▼                                   ║  │
│  ║       ┌─────────┐  ┌─────────┐  ┌─────────┐                              ║  │
│  ║       │   API   │  │ Worker  │  │   DB    │                              ║  │
│  ║       └─────────┘  └─────────┘  └─────────┘                              ║  │
│  ║                                                                           ║  │
│  ║  Kong Admin API: INTERNAL ONLY (never exposed to internet)               ║  │
│  ╚═══════════════════════════════════════════════════════════════════════════╝  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 12. CI/CD & Environments

> **Scope:** [MVP REQUIRED]

### 12.1 Environments

| Environment | Purpose | Data | Deployment |
|-------------|---------|------|------------|
| **dev** | Development and experimentation | Synthetic/mock | Automatic on PR |
| **test** | Automated testing | Test fixtures | Automatic on merge |
| **stage** | Pre-production validation | Anonymized production-like | Manual trigger |
| **prod** | Production | Real customer data | Manual approval required |

Each environment has completely isolated:
- Configuration files
- Secrets
- Data stores
- Network boundaries

### 12.2 Deployment Model (Docker Compose)

> **Detailed Pipeline:** See [VISA_CICD_PIPELINE.md](../operations/VISA_CICD_PIPELINE.md)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          CI/CD PIPELINE STAGES                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. BUILD         ──▶  Compile TypeScript, bundle assets                        │
│                                                                                  │
│  2. TEST          ──▶  Unit tests, integration tests                            │
│                                                                                  │
│  3. IMAGE SCAN    ──▶  SBOM generation, vulnerability scanning                  │
│                                                                                  │
│  4. IMAGE SIGN    ──▶  Cryptographic signing for integrity                      │
│                                                                                  │
│  5. PUSH          ──▶  Push to container registry                               │
│                                                                                  │
│  6. DEPLOY        ──▶  Remote deploy via SSH:                                   │
│                        docker compose pull && docker compose up -d              │
│                                                                                  │
│  7. HEALTH CHECK  ──▶  Verify services responding correctly                     │
│                                                                                  │
│  8. ROLLBACK      ──▶  If health check fails: revert to previous image tag      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 13. Disaster Recovery & Incident Modes

> **Scope:** [PHASED / LATER]

### 13.1 Backup

| Backup Type | Frequency | Retention | Verification |
|-------------|-----------|-----------|--------------|
| **PostgreSQL Full** | Daily | 30 days | Monthly restore test |
| **PostgreSQL WAL** | Continuous | 7 days | Part of restore test |
| **Configuration** | On change | Indefinite (Git) | N/A |
| **Secrets** | On rotation | Previous version kept | Rotation test |

### 13.2 Incident Flags

System-wide flags that can be set during incidents:

| Flag | Effect | Use Case |
|------|--------|----------|
| **PAUSE_ALL** | All job processing stops immediately | Critical incident, data integrity concern |
| **DRAIN_ONLY** | No new jobs accepted; existing jobs complete | Maintenance window, deployment |
| **READ_ONLY_API** | API serves reads only; writes rejected | Database maintenance |
| **HITL_ONLY** | Only HITL tasks processed; automation paused | Target site issues |

> **Incident Procedures:** See [VISA_PRODUCTION_RUNBOOK.md](../operations/VISA_PRODUCTION_RUNBOOK.md)

---

## 14. Hardening (Mandatory)

All production containers must implement these security measures:

| Measure | Implementation | Purpose |
|---------|----------------|---------|
| **Non-root** | `user: 1000:1000` in Compose | Prevent privilege escalation |
| **Read-only FS** | `read_only: true` | Prevent runtime modifications |
| **Capability Drop** | `cap_drop: [ALL]` | Minimize attack surface |
| **Seccomp** | Default or custom profile | Restrict syscalls |
| **AppArmor** | Container-specific profiles | MAC enforcement |
| **Network Isolation** | Separate Docker networks | Limit lateral movement |
| **Image Pinning** | Digest-based references | Prevent supply chain attacks |
| **SBOM** | Generated per build | Vulnerability tracking |
| **Vulnerability Scan** | Part of CI/CD | Block known vulnerabilities |

> **Production Configuration:** See [VISA_DOCKER_COMPOSE_PRODUCTION.md](../operations/VISA_DOCKER_COMPOSE_PRODUCTION.md)

---

## 15. Baseline Production Sizing

> **Scope:** [OPS]

### Sizing Tiers

The system is **browser-bound**, meaning RAM is the primary constraint for scaling worker concurrency. Each browser instance requires 1.5-2GB of RAM.

| Tier | VM Spec | Workers | Use Case |
|------|---------|---------|----------|
| **POC / Pilot** | 4 vCPU / 8 GB RAM | 1-2 | Proof of concept, short-term pilots, low-volume testing |
| **Production Minimum** | 4 vCPU / 16 GB RAM | 4-6 | Realistic starting point for production workloads |
| **Production Standard** | 8 vCPU / 32 GB RAM | 10-12 | Higher concurrency requirements |

> **Critical:** The 4 vCPU / 8 GB configuration is **NOT recommended for sustained production use**. With browser overhead (1.5-2GB per worker) plus system services (~4GB for API, PostgreSQL, Redis, Kong), 8GB severely limits worker concurrency to 1-2 workers maximum.

### Recommended Production Configuration

| Resource | Specification | Notes |
|----------|---------------|-------|
| **VM** | 4 vCPU / 16 GB RAM | Minimum for production workload |
| **Disk** | gp3 with 3000 IOPS | Adequate for PostgreSQL write load |
| **Observability** | Cloud-hosted | Grafana Cloud or equivalent |
| **Worker Concurrency** | Configuration-locked | Do not exceed RAM capacity |

### RAM Budget Calculation

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          RAM BUDGET (16 GB VM Example)                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Fixed Overhead:                                                                 │
│  ├── Operating System & Docker:     ~1.5 GB                                     │
│  ├── PostgreSQL (shared_buffers):   ~2.0 GB                                     │
│  ├── Redis:                         ~0.5 GB                                     │
│  ├── Kong:                          ~0.5 GB                                     │
│  ├── API Service:                   ~1.0 GB                                     │
│  └── HITL Artifact Storage Buffer:  ~0.5 GB                                     │
│      ─────────────────────────────────────                                      │
│      Total Fixed:                   ~6.0 GB                                     │
│                                                                                  │
│  Available for Workers:             ~10 GB                                       │
│  Worker Memory Requirement:         1.5-2.0 GB each                             │
│  ─────────────────────────────────────────────────────────────────────          │
│  Maximum Workers (conservative):    5 workers @ 2GB each                        │
│  Maximum Workers (aggressive):      6 workers @ 1.5GB each                      │
│                                                                                  │
│  RECOMMENDATION: Configure max 4-5 workers on 16GB VM for stability             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Per-Service Resource Allocation

| Service | CPU | RAM (Limit) | RAM (Reserve) | Notes |
|---------|-----|-------------|---------------|-------|
| API | 0.5-1 | 1 GB | 512 MB | Scales with request rate |
| Worker (each) | 1 | 2 GB | 1.5 GB | Browser memory requirement |
| PostgreSQL | 1 | 2 GB | 1 GB | Includes shared_buffers |
| Redis | 0.5 | 512 MB | 256 MB | Queue and lease storage |
| Kong | 0.5 | 512 MB | 256 MB | Gateway overhead |

### 15.1 Browser Concurrency Budget Table

The following table provides **practical concurrency limits** based on VM specifications, accounting for both RAM and CPU constraints. Playwright + Chromium with stealth plugins and screenshot/video capture is resource-intensive.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│              BROWSER CONCURRENCY ≈ RAM/CPU BUDGET REFERENCE                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  VM Spec           │ Available   │ Max Concurrent │ CPU        │ Notes          │
│                    │ for Workers │ Browsers       │ Constraint │                │
│  ──────────────────┼─────────────┼────────────────┼────────────┼────────────────│
│  4 vCPU / 8 GB     │ ~2 GB       │ 1 (safe)       │ 2-3 vCPU   │ POC only,      │
│                    │             │ 2 (tight)      │ contention │ not for prod   │
│  ──────────────────┼─────────────┼────────────────┼────────────┼────────────────│
│  4 vCPU / 16 GB    │ ~10 GB      │ 4-5 (safe)     │ 3-4 vCPU   │ Prod minimum,  │
│                    │             │ 6 (max)        │ at limit   │ CPU may limit  │
│  ──────────────────┼─────────────┼────────────────┼────────────┼────────────────│
│  8 vCPU / 32 GB    │ ~24 GB      │ 10-12 (safe)   │ 6-7 vCPU   │ Prod standard, │
│                    │             │ 14 (max)       │ headroom   │ recommended    │
│  ──────────────────┼─────────────┼────────────────┼────────────┼────────────────│
│  16 vCPU / 64 GB   │ ~54 GB      │ 24-27 (safe)   │ 12-14 vCPU │ High volume,   │
│                    │             │ 30 (max)       │ good       │ scale ceiling  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Key Constraints:**

| Resource | Per Browser | Why It Matters |
|----------|-------------|----------------|
| **RAM** | 1.5-2.0 GB | Chromium heap + page DOM + screenshots in memory |
| **CPU** | 0.75-1.0 vCPU | JS execution, rendering, video encoding |
| **Disk I/O** | Moderate | Screenshot/video writes, browser cache |

**Chromium + Stealth Overhead:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Browser Instance Memory Breakdown (typical visa form workflow)                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Base Chromium process:           ~400 MB                                        │
│  Page renderer (per tab):         ~200-400 MB (depends on DOM complexity)        │
│  Stealth plugin overhead:         ~50-100 MB                                     │
│  Screenshot buffer:               ~20-50 MB (per capture)                        │
│  Video recording (if enabled):    ~100-200 MB                                    │
│  JavaScript heap growth:          ~100-300 MB (during form filling)              │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  Total per worker:                1.0-1.5 GB (light) to 1.5-2.0 GB (heavy)       │
│                                                                                  │
│  RECOMMENDATION: Budget 2 GB per worker for safety margin                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**CPU Contention Warning:**

> ⚠️ On a 4 vCPU VM, running more than 3-4 concurrent browser instances will cause **CPU contention**, leading to:
> - Slower page loads and form interactions
> - Increased timeout failures  
> - Higher retry rates
> - Potential watchdog-triggered job abandonment
>
> **Rule of thumb:** `max_workers ≈ min(available_ram / 2GB, vCPUs - 1)`

### 15.2 Capacity Planning Quick Reference

| Throughput Goal | VM Spec | Workers | Jobs/Hour (est.) |
|-----------------|---------|---------|------------------|
| POC/Demo | 4c/8GB | 1-2 | 4-8 |
| Low volume | 4c/16GB | 4-5 | 16-20 |
| Medium volume | 8c/32GB | 10-12 | 40-50 |
| High volume | 16c/64GB | 24-27 | 100-120 |

*Assumes average job duration of 15-20 minutes per visa application.*

### 15.3 AWS Instance Recommendations

For AWS deployments, the following EC2 instance types are recommended:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       AWS EC2 INSTANCE SELECTION                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Tier         │ Instance Type │ vCPU │ RAM   │ Cost/mo* │ Workers │ Use Case    │
│  ─────────────┼───────────────┼──────┼───────┼──────────┼─────────┼─────────────│
│  POC          │ t3.large      │  2   │  8 GB │   ~$60   │   1     │ Testing     │
│  ─────────────┼───────────────┼──────┼───────┼──────────┼─────────┼─────────────│
│  ⚠️ NOT PROD  │ t3.xlarge     │  4   │ 16 GB │  ~$120   │   2-3   │ Pilot only  │
│  ─────────────┼───────────────┼──────┼───────┼──────────┼─────────┼─────────────│
│  PROD MIN     │ m6i.xlarge    │  4   │ 16 GB │  ~$140   │   4-5   │ Low volume  │
│  ─────────────┼───────────────┼──────┼───────┼──────────┼─────────┼─────────────│
│  PROD STD     │ m6i.2xlarge   │  8   │ 32 GB │  ~$280   │  10-12  │ Standard    │
│  ─────────────┼───────────────┼──────┼───────┼──────────┼─────────┼─────────────│
│  PROD HIGH    │ m6i.4xlarge   │ 16   │ 64 GB │  ~$560   │  24-27  │ High volume │
│                                                                                  │
│  * Costs are approximate, us-east-1, on-demand. Reserved instances ~40% cheaper. │
│                                                                                  │
│  Why M6i over T3 for production?                                                 │
│  • T3: Burstable CPU - good for spiky, not sustained browser workloads           │
│  • M6i: Consistent CPU - predictable performance for automation                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Storage (EBS):**

| Volume Type | IOPS | Throughput | Use Case | Cost/GB/mo |
|-------------|------|------------|----------|------------|
| gp3 (default) | 3,000 | 125 MB/s | Standard workloads | $0.08 |
| gp3 (tuned) | 6,000 | 250 MB/s | High write (many workers) | $0.08 + IOPS |
| io2 | 16,000+ | 500+ MB/s | Extreme (not needed) | $0.125+ |

**Recommended:** gp3 with 100GB, default IOPS for most deployments.

### 15.4 Traffic-Based Sizing Guide

Use this table to determine instance size based on expected monthly job volume:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    TRAFFIC → INSTANCE SIZE MAPPING                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Monthly Jobs │ Daily Avg │ Peak/Hour │ Instance     │ Workers │ Est. Cost/mo   │
│  ─────────────┼───────────┼───────────┼──────────────┼─────────┼────────────────│
│  < 500        │ ~15       │ ~5        │ t3.xlarge    │   2     │  ~$120 (pilot) │
│  500-2,000    │ ~65       │ ~20       │ m6i.xlarge   │   4-5   │  ~$160         │
│  2,000-5,000  │ ~165      │ ~40       │ m6i.2xlarge  │  10-12  │  ~$320         │
│  5,000-15,000 │ ~500      │ ~100      │ m6i.4xlarge  │  24-27  │  ~$640         │
│  > 15,000     │ 500+      │ 100+      │ Multi-server │  Scale  │  Contact sales │
│                                                                                  │
│  Calculation assumptions:                                                        │
│  • Average job duration: 15-20 minutes                                           │
│  • Peak hours: 6 hours/day of high activity                                      │
│  • Queue buffer: 30 minutes acceptable wait                                      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 15.5 Minimum Viable Production (MVP) Warning

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ⚠️  4 vCPU / 8 GB RAM IS NOT PRODUCTION-READY                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  8GB RAM Breakdown:                                                              │
│  ├── OS + Docker:        ~1.5 GB                                                 │
│  ├── PostgreSQL:         ~1.5 GB                                                 │
│  ├── Redis:              ~0.5 GB                                                 │
│  ├── Kong:               ~0.5 GB                                                 │
│  ├── API:                ~0.5 GB                                                 │
│  └── Available:          ~3.5 GB ← Only 1-2 browsers possible!                   │
│                                                                                  │
│  With 8GB you get:                                                               │
│  • 1-2 concurrent workers MAX                                                    │
│  • ~4-8 jobs/hour throughput                                                     │
│  • High risk of OOM under load                                                   │
│  • No headroom for spikes                                                        │
│                                                                                  │
│  VERDICT: Use 8GB for POC/demo ONLY. Production minimum is 16GB.                 │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

> **Cost Planning:** For detailed cost estimation including compute, proxy, storage, and total TCO, see [VISA_COST_ESTIMATION.md](../business/VISA_COST_ESTIMATION.md).

---

## 16. Customer Visibility, Billing Proof & Notifications

> **Scope:** [PHASED / LATER]

### 16.1 Business Model: Pay Per Successful Submission

The system operates on a **"pay per successful submission"** model, which requires:
1. **Defensible proof** that the work was completed
2. **Customer visibility** into job progress and outcomes
3. **Audit trail** for billing disputes

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         BILLING-GRADE EVIDENCE PACK                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Purpose: Tamper-evident, legally defensible proof of completed work             │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  EVIDENCE PACK CONTENTS                                                 │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │                                                                         │    │
│  │  1. FINAL SCREENSHOT                                                    │    │
│  │     • Captured at terminal state (COMPLETED)                            │    │
│  │     • Shows confirmation number/receipt                                 │    │
│  │     • PNG format, SHA-256 hashed                                        │    │
│  │                                                                         │    │
│  │  2. FSM TIMELINE                                                        │    │
│  │     • Complete state transition history                                 │    │
│  │     • Timestamps for each transition                                    │    │
│  │     • Duration metrics                                                  │    │
│  │                                                                         │    │
│  │  3. HITL ACTIONS (if any)                                               │    │
│  │     • What intervention was requested                                   │    │
│  │     • Who performed the action                                          │    │
│  │     • When it was resolved                                              │    │
│  │                                                                         │    │
│  │  4. INTEGRITY VERIFICATION                                              │    │
│  │     • SHA-256 manifest hash                                             │    │
│  │     • Optional: HMAC signature (recommended)                            │    │
│  │     • Optional: Ed25519 signature (enterprise)                          │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  Storage: S3-compatible object storage (immutable after sealing)                 │
│  Database: evidence_packs table with manifest_hash for verification              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 16.2 Billable Conditions (MUST ALL Be Met)

A job is **billable** only when ALL of the following conditions are satisfied:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         BILLABLE ELIGIBILITY CHECKLIST                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ☐ 1. jobs.status = 'COMPLETED'                                                 │
│       Job reached successful terminal state                                      │
│                                                                                  │
│  ☐ 2. evidence_packs.status = 'SEALED'                                          │
│       Evidence pack was generated and sealed (immutable)                         │
│                                                                                  │
│  ☐ 3. job_events contains 'EVIDENCE_PACK_SEALED' event                          │
│       Seal event recorded in audit log                                           │
│                                                                                  │
│  ☐ 4. job_events contains 'BILLING_ELIGIBLE' event                              │
│       Billing eligibility explicitly recorded                                    │
│                                                                                  │
│  ═══════════════════════════════════════════════════════════════════════════    │
│                                                                                  │
│  When ALL conditions met:                                                        │
│  → jobs.billing_status transitions: NOT_ELIGIBLE → ELIGIBLE                      │
│  → Job appears in billing reports                                                │
│  → Customer can be invoiced                                                      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Billing Status State Machine:**

```
                    job reaches COMPLETED
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  NOT_ELIGIBLE                                                                    │
│  (default state for all jobs)                                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
                           │
                           │ Evidence pack sealed
                           │ + BILLING_ELIGIBLE event emitted
                           ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ELIGIBLE                                                                        │
│  (ready for billing, appears in reports)                                         │
└───────────────────────────────┬─────────────────────────────────────────────────┘
                           │   │
           ┌───────────────┘   └───────────────┐
           │                                   │
           │ Invoice generated                 │ Customer disputes
           ▼                                   ▼
┌─────────────────────────┐        ┌─────────────────────────┐
│  BILLED                 │        │  DISPUTED               │
│  (billing processed)    │        │  (under review)         │
└─────────────────────────┘        └───────────┬─────────────┘
                                               │
                                   ┌───────────┴───────────┐
                                   │                       │
                                   ▼                       ▼
                           Dispute upheld          Dispute rejected
                           (refund issued)         → BILLED
```

### 16.3 Customer Visibility Model

#### Minimal Web Portal (Read-Optimized)

Customers access a **read-only portal** to view:
- Job list with status indicators
- Individual job details and timeline
- Evidence pack downloads (for COMPLETED jobs)
- Billing history

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CUSTOMER PORTAL CAPABILITIES                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ✅ ALLOWED (Read-Optimized):                                                    │
│                                                                                  │
│  • View job list with status                                                     │
│  • View job details (timeline, metadata)                                         │
│  • Download evidence pack (COMPLETED jobs only)                                  │
│  • View billing history and invoices                                             │
│  • Request manual review / support ticket                                        │
│                                                                                  │
│  ❌ NOT ALLOWED (to prevent system abuse):                                       │
│                                                                                  │
│  • High-frequency polling (rate limited)                                         │
│  • Direct database queries                                                       │
│  • Modifying job state                                                           │
│  • Canceling in-progress jobs (must use API)                                     │
│                                                                                  │
│  Rate Limiting:                                                                  │
│  • Job list: 10 req/min                                                          │
│  • Job details: 30 req/min                                                       │
│  • Evidence download: 5 req/min                                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Event-Driven Notifications

Instead of polling, customers receive **push notifications** for key events:

| Event | Email | Webhook | In-App |
|-------|-------|---------|--------|
| Job COMPLETED | ✅ | ✅ | ✅ |
| Job FAILED_TERMINAL | ✅ | ✅ | ✅ |
| HITL required (optional) | ⚙️ | ✅ | ✅ |
| Invoice generated | ✅ | ✅ | ✅ |
| Evidence pack ready | ✅ | ✅ | ✅ |

**Webhook Payload Example:**

```json
{
  "event_type": "job.completed",
  "timestamp": "2026-01-25T12:00:00Z",
  "tenant_id": "tenant-uuid",
  "data": {
    "job_id": "job-uuid",
    "status": "COMPLETED",
    "confirmation_number": "VISA-2026-ABC123",
    "completed_at": "2026-01-25T11:55:00Z",
    "evidence_pack_url": "https://portal.example.com/jobs/job-uuid/evidence",
    "billable": true
  },
  "signature": "hmac-sha256:..."
}
```

### 16.4 Anti-Polling Enforcement

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         HIGH-FREQUENCY POLLING: PROHIBITED                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PROBLEM: Polling-based integrations can:                                        │
│  • Overwhelm the API with redundant requests                                     │
│  • Increase costs and latency                                                    │
│  • Miss events between polls                                                     │
│                                                                                  │
│  SOLUTION: Event-driven architecture with webhooks                               │
│                                                                                  │
│  ENFORCEMENT:                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Rate limiting on status endpoints:                                  │    │
│  │     • GET /jobs/:id → 30 req/min per tenant                             │    │
│  │     • GET /jobs → 10 req/min per tenant                                 │    │
│  │                                                                         │    │
│  │  2. 429 Too Many Requests with Retry-After header                       │    │
│  │                                                                         │    │
│  │  3. Webhook delivery with retry:                                        │    │
│  │     • 3 attempts with exponential backoff                               │    │
│  │     • Dead letter queue for persistent failures                         │    │
│  │     • Webhook status dashboard for customers                            │    │
│  │                                                                         │    │
│  │  4. Documentation prominently warns against polling:                    │    │
│  │     "Use webhooks for real-time updates. Polling is rate-limited        │    │
│  │      and may result in temporary API access suspension."                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  RECOMMENDED INTEGRATION PATTERN:                                                │
│                                                                                  │
│  1. Submit job via API → receive job_id                                          │
│  2. Wait for webhook notification (job.completed or job.failed)                  │
│  3. Download evidence pack if needed                                             │
│  4. (Optional) Query /jobs/:id for additional details                            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 16.5 Billing Integration Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           END-TO-END BILLING FLOW                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  JOB SUBMISSION                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Customer → POST /jobs                                                  │    │
│  │  • jobs.billing_status = NOT_ELIGIBLE                                   │    │
│  │  • Event: JOB_CREATED                                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Job processing (FSM states)                                              │
│       ▼                                                                          │
│  JOB COMPLETION                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Worker → job reaches COMPLETED                                         │    │
│  │  • Event: STATE_TRANSITION (to COMPLETED)                               │    │
│  │  • Trigger: Evidence pack generation                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  EVIDENCE SEALING                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  System → Generate and seal evidence pack                               │    │
│  │  • Upload pack to S3                                                    │    │
│  │  • evidence_packs.status = SEALED                                       │    │
│  │  • Event: EVIDENCE_PACK_SEALED                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  BILLING ELIGIBILITY                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  System → Mark job as billable                                          │    │
│  │  • jobs.billing_status = ELIGIBLE                                       │    │
│  │  • jobs.billable_outcome = 'VISA_SUBMITTED'                             │    │
│  │  • Event: BILLING_ELIGIBLE                                              │    │
│  │  • Webhook: job.completed (with billable: true)                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Billing system processes (daily/weekly)                                  │
│       ▼                                                                          │
│  INVOICE GENERATION                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Billing → Generate invoice for ELIGIBLE jobs                           │    │
│  │  • jobs.billing_status = BILLED                                         │    │
│  │  • jobs.billed_at = now()                                               │    │
│  │  • jobs.billing_ref = 'INV-2026-001'                                    │    │
│  │  • Event: BILLED                                                        │    │
│  │  • Webhook: invoice.generated                                           │    │
│  │  • Email: Invoice notification                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

> **Implementation Details:** See [VISA_LOGGING_STRATEGY.md](../security/VISA_LOGGING_STRATEGY.md) for evidence pack sealing procedures and [VISA_DATABASE_SCHEMA.md](../database/VISA_DATABASE_SCHEMA.md) for table definitions.

---

## 17. Final Statement

This document is the **Final Locked Specification**.

The system is:
- ✅ **Buildable** — Clear technology choices and integration patterns
- ✅ **Operable** — Comprehensive monitoring, alerting, and runbooks
- ✅ **Resilient** — Deterministic recovery from any failure mode

---

## 18. Database Growth, Retention & Partitioning Strategy

> **Scope:** [OPS]

### 18.1 Append-Only Audit Log Reality

The `job_events` table is designed as an **append-only audit log** to guarantee traceability and forensic visibility.

**Growth Projections (Realistic Workload):**

| Metric | Value | Calculation |
|--------|-------|-------------|
| Jobs per day | ~1,000 | Business estimate |
| Events per job | ~50 | State transitions + checkpoints |
| Rows per day | ~50,000 | 1,000 × 50 |
| Rows per month | ~1.5M | 50,000 × 30 |
| Rows per year | ~18M | 1.5M × 12 |

This growth is **expected and acceptable**, but must be operationally managed.

### 18.2 Partitioning Strategy (Planned, Not Mandatory Day-1)

PostgreSQL **time-based partitioning** SHALL be applied when:

| Trigger | Threshold |
|---------|-----------|
| Table size | Exceeds operational thresholds (~5M rows) |
| Query latency | Degrades on recent events |
| Maintenance cost | VACUUM/ANALYZE duration increases |

**Recommended Model:**
- RANGE partitioning by `created_at`
- Monthly partitions
- Indexes only on active (hot) partitions

**Example Partitions:**
```
job_events_2026_01
job_events_2026_02
job_events_2026_03
...
```

> **Detailed Partitioning Guide:** See [VISA_DB_PARTITIONING.md](../database/VISA_DB_PARTITIONING.md)

### 18.3 Retention & Archival Policy

| Data Phase | Duration | Storage | Purpose |
|------------|----------|---------|---------|
| **Hot** | 0-90 days | PostgreSQL (Partitioned) | Fast queries, debugging, audits |
| **Cold** | >90 days | Encrypted Object Storage (S3-compatible) | Compliance, forensic access |
| **Purged** | Per policy | N/A | Cost control |

**Archive Format:**
- Compressed JSON or Parquet
- Immutable after archival
- Queryable offline if needed

### 18.4 Archival Job

A scheduled maintenance job handles the archive lifecycle:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          ARCHIVAL JOB FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. SELECT    ──▶  Identify partitions older than retention window              │
│                                                                                  │
│  2. EXPORT    ──▶  Dump partition data to compressed file                       │
│                                                                                  │
│  3. VERIFY    ──▶  Calculate and verify checksum                                │
│                                                                                  │
│  4. UPLOAD    ──▶  Transfer to object storage with checksum                     │
│                                                                                  │
│  5. DROP      ──▶  Remove partition from PostgreSQL                             │
│                                                                                  │
│  6. AUDIT     ──▶  Write archival record to system_events                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Guarantees:**
- Idempotent (can be re-run safely)
- Failure-safe (partial failures don't corrupt data)
- Audited (all actions logged)

> **Detailed Archival Procedures:** See [VISA_JOB_EVENTS_ARCHIVAL.md](../database/VISA_JOB_EVENTS_ARCHIVAL.md)

### 18.5 Why This Is Operational, Not Architectural

This strategy is purely operational and can be introduced incrementally:

| Aspect | Impact |
|--------|--------|
| **Runtime** | No dependency on archived data |
| **FSM Logic** | No changes required |
| **Worker Logic** | No changes required |
| **API** | No changes required |

This strategy preserves system correctness while keeping operational costs predictable.
