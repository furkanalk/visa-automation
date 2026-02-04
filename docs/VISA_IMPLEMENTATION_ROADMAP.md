# VISA Implementation Roadmap (Tagged Edition)

This is the **MASTER implementation roadmap**.
Follow phases sequentially.

Rules:
- Do NOT skip phases
- Complete each phase fully before the next
- Other docs explain HOW, this explains WHEN

Scope tags:
[MVP]  required for first production
[OPS]  operational safety
[LATER] scaling/enterprise improvements

---
# Implementation Roadmap (Internal Ops Mode)

> **Document Status:** Active Roadmap (Customized)  
> **Version:** 1.2 (Internal Ops + Cross-References)  
> **Last Updated:** February 2026  
> **Scope:** Visa consultancy internal automation platform (not a customer-facing SaaS billing product).  
> **Definition of Success:** **Appointment found and reserved** (date/time/reference captured).

---

## Table of Contents

1. [Overview](#overview)  
2. [Document Map (What each doc is for)](#document-map-what-each-doc-is-for)  
3. [Operating Assumptions](#operating-assumptions)  
4. [Phase 0: Repo & Environment Baseline](#phase-0-repo--environment-baseline)  
5. [Phase 1: Production Compose Bring-up](#phase-1-production-compose-bring-up)  
6. [Phase 2: Database Init + Growth Guardrails](#phase-2-database-init--growth-guardrails)  
7. [Phase 3: Minimal Backend API](#phase-3-minimal-backend-api)  
8. [Phase 4: Core Worker v0 (Single Portal)](#phase-4-core-worker-v0-single-portal)  
9. [Phase 4.5: Network & Throttling Guardrails](#phase-45-network--throttling-guardrails)  
10. [Phase 5: End-to-End First Run (Pilot)](#phase-5-end-to-end-first-run-pilot)  
11. [Phase 6: HITL v1 (OTP + CAPTCHA)](#phase-6-hitl-v1-otp--captcha)  
12. [Phase 7: Light Evidence (Ops-Grade)](#phase-7-light-evidence-ops-grade)  
13. [Phase 8: Notifications](#phase-8-notifications)  
14. [Phase 10: Hardening & Ops](#phase-10-hardening--ops)  
15. [Appendix A: FSM (Internal Ops)](#appendix-a-fsm-internal-ops)  
16. [Appendix B: What We Removed (Payments Lifecycle)](#appendix-b-what-we-removed-payments-lifecycle)  

---

## Overview

This roadmap is optimized for a visa consultancy that:
- Has **5+ operators**
- Handles **1–30 apps/day normally**, **30–300 apps/day peak**
- Needs **~10-minute maximum acceptable time** per attempt (SLA)
- Stops for **OTP** (email) and handles **CAPTCHA frequently**
- Faces **IP bans / rate limiting**
- Uses **company card for payments** (customer pays the consultancy offline)

Guiding principles:
- **Skeleton first, features later**
- **Stop/Go gates** at each phase
- **Production environment early**
- **One target adapter only** until the first successful job

---

## Document Map (What each doc is for)

This roadmap tells you **when** to build things.  
The referenced documents tell you **how** each part must behave.

### Core architecture & behavior
- **VISA_SAAS_ARCHITECTURE.md** — overall system structure (services, data flows, boundaries)
- **VISA_SAAS_TECHNOLOGY_AND_SYSTEMS.md** — chosen tech stack & infra components
- **VISA_WORKER_LIFECYCLE.md** — worker behavior, determinism, resume rules, failure handling
- **VISA_CORE_API_CONTRACT.md** — API request/response contracts and invariants

### Target portals & comms
- **VISA_PORTAL_AND_NOTIFICATIONS.md** — portal approach + notification semantics
- **VISA_LOGGING_STRATEGY.md** — what to log, how to correlate, auditability

### CAPTCHA / anti-bot / stability
- **VISA_CAPTCHA_SOLVER_STRATEGY.md** — layered CAPTCHA strategy (automated → external solver → HITL), cost/latency considerations
- **(This roadmap) Phase 4.5** — rate limiting/ban avoidance guardrails and circuit breaking

### Database & retention
- **VISA_DATABASE_SCHEMA.md** — tables and relations
- **VISA_DATABASE_OPERATIONAL_GUARDS.md** — operational constraints, pooling, safety checks
- **VISA_DB_PARTITIONING.md** — `job_events` partitioning policy
- **VISA_JOB_EVENTS_ARCHIVAL.md** — archival/retention and cold storage patterns

### Security & data protection
- **VISA_SECURITY_MODEL.md** — authn/authz model, tenancy, threat model, secrets handling
- **VISA_DATA_PROTECTION.md** — PII policy, retention, encryption requirements

### Production, CI/CD, reliability
- **VISA_DOCKER_COMPOSE_PRODUCTION.md** — hardened production compose guidance
- **VISA_CICD_PIPELINE.md** — build/test/release pipeline expectations
- **VISA_ZERO_DOWNTIME_DEPLOYMENT.md** — safe deploy, worker drain, migrations strategy
- **VISA_PRODUCTION_RUNBOOK.md** — incident response procedures and playbooks
- **VISA_GRAFANA_DASHBOARDS.md** — required dashboards and alert signals

### Evidence & payments (kept as references; v1 is simplified)
- **VISA_EVIDENCE_FINALIZATION.md** — full evidence sealing model (we use a light variant in Phase 7)
- **VISA_PAYMENTS_LIFECYCLE.md** — full payments lifecycle (removed from v1; see Appendix B)
- **VISA_COST_ESTIMATION.md** — cost model (infra/ops/solvers)

---

## Operating Assumptions

### A. Success criteria (business)
✅ Successful job:
- Appointment found AND reserved (portal gives date/time + reference/confirmation if available)
- Evidence: reference + timestamp; screenshot optional but recommended

❌ Not billable / not a success:
- No appointment available
- Portal downtime / timeouts
- CAPTCHA/OTP solved but no slot exists
- Payment step cannot be reached

### B. Data protection constraints
- Do **NOT** store passport scans/IDs long-term.
- Store only what is required to run the automation, and support ops troubleshooting.
- OTP is via email; we can prefer **auto-parse** when reliable, else HITL.
- Follow **VISA_DATA_PROTECTION.md** and **VISA_SECURITY_MODEL.md**.

### C. Payment model
- Payments are paid using **company card**; customer reimburses offline.
- No payment provider integration needed in v1.

---

## Phase 0: Repo & Environment Baseline

**Duration:** 0.5–1 day

### Goal
Runnable skeleton before business logic.

### References
- VISA_SAAS_TECHNOLOGY_AND_SYSTEMS.md
- VISA_CICD_PIPELINE.md

### Deliverables
Monorepo structure:

```
visa-automation/
├── packages/
│   ├── backend/          # API service
│   ├── worker/           # Playwright worker
│   ├── web/              # Ops UI (HITL + job list)
│   ├── shared-types/     # Shared TS types
│   └── adapters/         # 1 portal adapter at a time
├── infra/
│   ├── docker/
│   └── compose/
├── docs/
├── scripts/
├── .env.example
├── Makefile
└── package.json
```

### Success Criteria (Stop/Go)
| Check | Command | Expected |
|---|---|---|
| Local env starts | `make up` | All containers healthy |
| API health | `curl localhost:3000/health` | `200 OK` |
| Redis | `docker compose exec redis redis-cli ping` | `PONG` |
| Postgres | `docker compose exec postgres psql -U postgres -c '\l'` | DB list |
| Lint | `make lint` | Exit 0 |
| Tests | `make test` | Exit 0 |

---

## Phase 1: Production Compose Bring-up

**Duration:** 1 day

### Goal
Single-server hardened stack running on target VM.

### References
- VISA_DOCKER_COMPOSE_PRODUCTION.md
- VISA_ZERO_DOWNTIME_DEPLOYMENT.md (deploy approach expectations)
- VISA_SECURITY_MODEL.md (secrets, network boundaries)

### Deliverables
Production compose with:
- Kong (edge)
- Backend (healthcheck only at first)
- Worker (dummy at first)
- PostgreSQL + Redis
- Network isolation, non-root, RO FS where possible, tmpfs

### Success Criteria (Stop/Go)
| Check | Duration | Expected |
|---|---:|---|
| All containers running | 30 min | No restarts |
| No OOM | 30 min | `docker stats` stable |
| Health checks | 30 min | All green |

---

## Phase 2: Database Init + Growth Guardrails

**Duration:** 0.5–1 day

### Goal
Schema deployed, partitions/retention ready, backups working.

### References
- VISA_DATABASE_SCHEMA.md
- VISA_DB_PARTITIONING.md
- VISA_JOB_EVENTS_ARCHIVAL.md
- VISA_DATABASE_OPERATIONAL_GUARDS.md

### Deliverables
- Core schema for jobs/runs/events/HITL
- `job_events` partitions created (current + next 2 months)
- Daily backup + restore test

### Success Criteria (Stop/Go)
| Check | Expected |
|---|---|
| Schema exists | Tables present |
| Partitions exist | Inserts land in correct partition |
| Backup exists | Daily backup file present |
| Restore works | Restore to test DB succeeds |

---

## Phase 3: Minimal Backend API

**Duration:** 1–2 days

### Goal
Smallest API surface to create/track jobs.

### References
- VISA_CORE_API_CONTRACT.md
- VISA_SECURITY_MODEL.md
- VISA_LOGGING_STRATEGY.md

### Endpoint Set (v0)
| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness |
| `/health/ready` | GET | Readiness |
| `/jobs` | POST | Create job |
| `/jobs` | GET | List jobs |
| `/jobs/:id` | GET | Job detail/status |
| `/jobs/:id/pause` | POST | Pause |
| `/jobs/:id/retry` | POST | Retry |
| `/hitl/:id/resolve` | POST | Resolve HITL (noop until Phase 6) |
| `/admin/incident-mode` | POST | PAUSE_ALL / DRAIN_ONLY / NORMAL |

### Success Criteria (Stop/Go)
| Check | Test | Expected |
|---|---|---|
| Create job | `POST /jobs` | 201 + job_id |
| Idempotency | same key twice | same job_id |
| Enqueue | `LLEN visa:queue:jobs` | > 0 |
| Auth required | no token | 401 |

---

## Phase 4: Core Worker v0 (Single Portal)

**Duration:** 2–7 days

### Goal
Worker picks job, logs in, fills form, searches slots, reserves appointment when available.

### References
- VISA_WORKER_LIFECYCLE.md
- VISA_PORTAL_AND_NOTIFICATIONS.md
- VISA_LOGGING_STRATEGY.md
- VISA_SECURITY_MODEL.md (credentials handling)

### Deliverables
- Adapter interface
- **1 portal adapter only**
- Minimal FSM working
- Checkpoint/resume
- Graceful shutdown

### Minimal FSM (v0)
```
QUEUED
  → LOGIN_PROCESS
  → FORM_FILLING
  → SLOT_SEARCH
  → APPOINTMENT_FOUND (SUCCESS)
  → COMPLETED
        │
        ├─ FAILED_RETRYABLE
        └─ PAUSED
```

### Success Criteria (Stop/Go)
| Check | Expected |
|---|---|
| Picks job | Worker acquires from queue |
| Checkpoints | `current_state` updated |
| Crash-safe | SIGTERM → PAUSED |
| Resume | PAUSED job resumes |
| Appointment capture | reference + date/time stored when found |

---

## Phase 4.5: Network & Throttling Guardrails

**Duration:** 1–2 days (do not skip)

### Goal
Prevent bans, control costs, and keep the system stable under rate limits.

### References
- VISA_CAPTCHA_SOLVER_STRATEGY.md (ban/captcha rate, warming guidance)
- VISA_GRAFANA_DASHBOARDS.md (signals/alerts)
- VISA_PRODUCTION_RUNBOOK.md (incident response)

### Deliverables
- Per-domain concurrency cap
- Per-domain request budget (RPM/RPH)
- Adaptive backoff on 429/403/timeouts
- Circuit breaker (error spike → pause portal traffic)
- Metrics: 429 rate, 403 rate, timeout rate, ban suspicion rate

> Note: Sustained CAPTCHA frequency or repeated solver failures should be treated as bot-detection signals contributing to circuit breaker decisions.

### Success Criteria (Stop/Go)
| Check | Expected |
|---|---|
| Backoff works | 429 increases → request rate drops |
| Circuit breaker | sustained failures → jobs PAUSED (not FAILED_TERMINAL) |
| Observability | metrics visible in Grafana/logs |

---

## Phase 5: End-to-End First Run (Pilot)

**Duration:** 0.5–1 day

### Goal
First real job completes successfully end-to-end.

### References
- VISA_WORKER_LIFECYCLE.md (determinism + resume)
- VISA_PRODUCTION_RUNBOOK.md (pilot run checklist style)
- VISA_GRAFANA_DASHBOARDS.md (observe the run)

### Success Criteria (Stop/Go)
| Check | Expected |
|---|---|
| Job success | APPOINTMENT_FOUND/COMPLETED |
| Timeline | job_events shows full transitions |
| Determinism | same inputs follow same path |
| No ban behavior | guardrails active |

---

## Phase 6: HITL v1 (OTP + CAPTCHA)

**Duration:** 2–5 days

### Goal
Human-in-the-loop for OTP/CAPTCHA. Worker pauses, human resolves, worker continues.

### References
- VISA_CAPTCHA_SOLVER_STRATEGY.md (layered solver + escalation)
- VISA_WORKER_LIFECYCLE.md (pause/resume semantics)
- VISA_PORTAL_AND_NOTIFICATIONS.md (notification triggers)
- VISA_LOGGING_STRATEGY.md (audit trail)

### Deliverables
- `WAITING_HITL` state
- HITL task UI (screenshot + instructions)
- Expiry policy + escalation
- (Optional) OTP email auto-parse module

> CAPTCHA handling uses the layered strategy defined in **VISA_CAPTCHA_SOLVER_STRATEGY.md** (automated → external solver → HITL fallback).

### OTP Email Adapter (Optional but recommended)
- IMAP/Graph API poll (ops mailbox)
- Parse OTP patterns
- If confidence high → auto-resolve HITL
- Else → route to operator

### Success Criteria (Stop/Go)
| Check | Expected |
|---|---|
| CAPTCHA/OTP triggers | Job → WAITING_HITL |
| Operator resolves | Job continues |
| Expiry | timeout → FAILED_RETRYABLE or PAUSED |
| No concurrency overload | operator can handle 1 at a time |

---

## Phase 7: Light Evidence (Ops-Grade)

**Duration:** 0.5–1 day

### Goal
Provide operational proof without heavy “billing-grade sealing”.

### References
- VISA_EVIDENCE_FINALIZATION.md (full model; we implement a minimal subset)
- VISA_LOGGING_STRATEGY.md (what is safe to store)
- VISA_DATA_PROTECTION.md (retention and minimization)

### Deliverables (Light)
- Store:
  - appointment reference number (if any)
  - date/time
  - portal branch/city
  - one final screenshot (optional)
- Retention: short (e.g., 7–30 days), configurable

### What we are NOT doing in v1
- Cryptographic sealing/signing
- Immutable evidence packs
- Long-term retention requirements

### Success Criteria (Stop/Go)
| Check | Expected |
|---|---|
| Success info stored | reference + datetime stored |
| Screenshot available | optional but works |
| PII minimized | no unnecessary fields stored |

---

## Phase 8: Notifications

**Duration:** 1–2 days

### Goal
Operators get fast signals when HITL needed / appointment found / job failed.

### References
- VISA_PORTAL_AND_NOTIFICATIONS.md
- VISA_LOGGING_STRATEGY.md
- VISA_SECURITY_MODEL.md

### Deliverables
- Email notifications (SMTP/SES)
- Optional webhook (internal)
- Dedup + rate limits (avoid spam)

### Key Notifications
- WAITING_HITL → notify ops
- APPOINTMENT_FOUND → notify ops
- FAILED_RETRYABLE (after N retries) → notify ops

---

## Phase 10: Hardening & Ops

**Duration:** Ongoing

### References
- VISA_PRODUCTION_RUNBOOK.md
- VISA_GRAFANA_DASHBOARDS.md
- VISA_ZERO_DOWNTIME_DEPLOYMENT.md
- VISA_DATABASE_OPERATIONAL_GUARDS.md
- VISA_COST_ESTIMATION.md

### Must-have hardening for this domain
- Canary job(s): portal DOM change detection (see VISA_CAPTCHA_SOLVER_STRATEGY.md, Canary Jobs section)
- Adapter hotfix playbook (rollback)
- Runbook for: queue backlog, crashlooping, DB disk full
- Backup drills (restore test)
- Resource limits + tmpfs sizing for Playwright
- Credential isolation + least privilege
- Incident mode: pause-all/drain-only

---

## Appendix A: FSM (Internal Ops)

Recommended FSM (expanded but still ops-focused):

```
QUEUED
  → LOGIN_PROCESS
  → FORM_FILLING
  → SLOT_SEARCH
     ├─ NO_SLOT_YET → SCHEDULED_RETRY (backoff) → SLOT_SEARCH
     ├─ RATE_LIMITED → BACKOFF → SLOT_SEARCH
     ├─ WAITING_HITL (OTP/CAPTCHA) → RESUMING → SLOT_SEARCH
     └─ APPOINTMENT_FOUND → (optional PAYMENT_STEP) → COMPLETED
```

Notes:
- If portal requires payment to finalize reservation, keep it as a simple state:
  - PAYMENT_PENDING → PAYMENT_DONE
- Still **no payment provider integration**.

---

## Appendix B: What We Removed (Payments Lifecycle)

Removed from v1 because:
- This is an internal consultancy tool
- Company pays with its own card
- Customers reimburse offline
- Payment provider integration adds compliance + complexity

If later needed (e.g., SaaS product), reintroduce as a separate roadmap branch.

---


---

## Architecture Alignment Additions

### Agent / Portal Model [MVP]
- treat worker as agent
- assign agents to specific portals
- SERIAL / PARALLEL execution policy
- configurable concurrency limits
- admin pause/resume portal

### Ban / Rate‑Limit Protection [MVP]
- detect 403/429 spikes
- circuit breaker
- automatic portal pause
- proxy rotation
- run canary before resume

### Canary / Change Detection [MVP]
- scheduled canary job per portal
- DOM/selector verification
- alert on change

### Security & Compliance [MVP]
- RBAC + service tokens
- encrypted PII
- masked logs
- no card storage

### Deployment Safety [OPS]
- zero‑downtime deployment
- worker drain before restart
- post‑deploy canary validation

---
