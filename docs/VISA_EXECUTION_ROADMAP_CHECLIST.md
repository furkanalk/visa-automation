# VISA Automation – Execution Roadmap (Checklist Edition)

This file is the MASTER build plan.

Rules:
- Do NOT skip phases
- Complete all checkboxes before next phase

Scope:
[MVP] required for first production
[OPS] operational safety
[LATER] future improvements

---

# VISA Execution Roadmap – Step‑by‑Step Checklist

Purpose: This document is an **execution checklist**, not a design doc.
Follow phases in order. Do NOT skip phases.

Tick every box before moving to the next phase.

---

# Phase 0 — Project Bootstrap

## Goal
Local dev environment running.

## Checklist
- [ ] Monorepo created (apps/api, apps/worker, apps/web, shared)
- [ ] TypeScript config ready
- [ ] ESLint + Prettier
- [ ] .env.example created
- [ ] docker-compose.dev.yml created
- [ ] Postgres container works
- [ ] Redis container works
- [ ] API /health returns 200
- [ ] make up / make down scripts

## Done When
- Everything starts with one command


---

# Phase 0.5 — Proxy & Portal Adapter Foundations (MVP Critical)

## Goal
Prevent bans and avoid re-discovering portal details repeatedly.

## Checklist — Proxy / Forward Strategy
- [ ] Define proxy modes: **datacenter**, **residential**, **mobile** (choose what you will actually buy/use)
- [ ] Define **sticky session** rule (job_run → proxy identity binding)
- [ ] Implement proxy pool model:
  - [ ] `proxy_provider` abstraction (multiple providers)
  - [ ] health score (success %, 403/429 rate, latency)
  - [ ] cooldown / quarantine list on suspected ban
  - [ ] per-portal pool (some portals burn faster)
- [ ] Implement request shaping:
  - [ ] per-portal **RPM/RPH budgets**
  - [ ] jittered delays
  - [ ] concurrency caps (SERIAL/PARALLEL + max_concurrency)
- [ ] Implement proxy rotation rules:
  - [ ] rotate on 403/429 spike
  - [ ] rotate on CAPTCHA wall escalation
  - [ ] rotate on repeated timeouts
- [ ] Define “Incident Mode” behavior:
  - [ ] auto pause portal
  - [ ] notify admin
  - [ ] require canary pass before resume

## Checklist — Portal Adapter Playbook (per portal)
Create a short living playbook per portal (idata, as‑visa, etc.):
- [ ] Login steps + selectors
- [ ] Form field mapping + validation rules
- [ ] Slot search behavior (what is “slot open”)
- [ ] Error taxonomy (known error pages/messages)
- [ ] OTP entry point + timeout
- [ ] CAPTCHA type + trigger frequency
- [ ] Payment page behavior (3DS? redirects?)
- [ ] “Known breakpoints” (where HITL may be needed)

## Done When
- Proxy pool + sticky sessions exist in code (even if simple)
- At least 1 portal has a documented playbook and a minimal adapter skeleton

---

# Phase 1 — Production Stack

## Goal
Hardened server environment.

## Checklist
- [ ] docker-compose.production.yml
- [ ] Kong configured
- [ ] API behind gateway
- [ ] Redis + Postgres persistent volumes
- [ ] Secrets via env/secret files
- [ ] Health checks
- [ ] 30 min soak test (no crash)

## Done When
- Containers stable for 30 min

---

# Phase 2 — Database

## Goal
Core schema live.

## Checklist
- [ ] jobs table
- [ ] job_runs table
- [ ] job_events table
- [ ] hitl_tasks table
- [ ] workers table
- [ ] migrations script
- [ ] job_events partitioning
- [ ] daily backup script
- [ ] restore test

## Done When
- Can insert + restore successfully

---

# Phase 3 — API v0

## Goal
Control plane.

## Checklist
- [ ] POST /jobs
- [ ] GET /jobs
- [ ] GET /jobs/:id
- [ ] pause endpoint
- [ ] retry endpoint
- [ ] idempotency key
- [ ] request logging
- [ ] auth middleware
- [ ] rate limit

## Done When
- Jobs appear in Redis queue

---

# Phase 4 — Worker v0 (Core Automation)

## Goal
Bot completes form automatically.

## Checklist
- [ ] BullMQ consumer
- [ ] Redis lease lock
- [ ] Worker heartbeat
- [ ] SIGTERM graceful shutdown
- [ ] Adapter interface
- [ ] Portal login
- [ ] Form fill
- [ ] Slot search
- [ ] Save checkpoints
- [ ] Resume logic
- [ ] Crash test
- [ ] Determinism test

## Done When
- Crash → resumes → finishes

---

# Phase 4.5 — Rate Limit & Ban Protection

## Goal
Avoid bans.

## Checklist
- [ ] proxy pool + rotation rules (from Phase 0.5)
- [ ] proxy health score + cooldown/quarantine
- [ ] sticky session enforcement per job_run
- [ ] portal-level budgets (rpm/rph) wired to limiter
- [ ] auto-pause portal on ban suspicion + cooldown timer
- [ ] resume requires canary pass
- [ ] per-domain concurrency limit
- [ ] request delay config
- [ ] exponential backoff
- [ ] 429/403 counter
- [ ] circuit breaker pause
- [ ] metrics exposed

## Done When
- 429 spike automatically pauses

---

# Phase 5 — First Real Run

## Goal
First successful appointment.

## Checklist
- [ ] test account ready
- [ ] 5–10 jobs run
- [ ] timeline verified
- [ ] no crashes
- [ ] no bans

- [ ] define payment edge-cases policy (3DS, decline, timeout) + state mapping
- [ ] confirm "card data never stored" + logs redacted


## Done When
- At least 1 success

---

# Phase 6 — OTP + CAPTCHA (HITL)

## Goal
Human fallback.

## Checklist
- [ ] WAITING_HITL state
- [ ] screenshot capture
- [ ] HITL UI
- [ ] resolve endpoint
- [ ] email notifications
- [ ] optional email OTP auto parse
- [ ] integrate layered strategy (auto → solver → human)

## Done When
- OTP handled without killing job

---

# Phase 7 — Light Evidence

## Goal
Basic proof only.

## Checklist
- [ ] store reference number
- [ ] store date/time
- [ ] optional screenshot
- [ ] retention policy

## Done When
- Can show proof for each success

---

# Phase 8 — Notifications

## Goal
Ops awareness.

## Checklist
- [ ] email alerts
- [ ] HITL alert
- [ ] success alert
- [ ] failure alert
- [ ] dedup logic

## Done When
- Operators always notified

---

# Phase 9 — Agent & Portal Control Panel

## Goal
See & control agents (workers) and portal policies.

## Checklist
- [ ] /agents endpoint
- [ ] /portal-policies endpoint
- [ ] agent assignments to portals
- [ ] serial/parallel policy editor per portal
- [ ] pause/resume portal
- [ ] /workers endpoint (legacy alias)
- [ ] heartbeat storage
- [ ] show status
- [ ] pause worker
- [ ] resume worker
- [ ] drain worker
- [ ] pause-all

## Done When
- No SSH needed to operate

---

# Phase 10 — Hardening

## Goal
Production ready.

## Checklist
- [ ] Grafana dashboards
- [ ] alerts
- [ ] canary jobs
- [ ] backup drill
- [ ] load test
- [ ] incident runbook
- [ ] log rotation
- [ ] cost check

## Done When
- System stable for 7 days

---

# Rule

Never skip a phase.
Never proceed without Done criteria.


---

## Additional Mandatory Items (Aligned with current architecture)

### Agent / Portal Model [MVP]
- agent concept (worker = agent)
- portal assignment
- SERIAL/PARALLEL policy
- configurable concurrency
- admin pause/resume

### Ban / Rate‑Limit Protection [MVP]
- detect 403/429 spikes
- circuit breaker
- auto pause
- proxy rotation
- canary before resume

### Canary / Change Detection [MVP]
- scheduled canary per portal
- DOM/selector validation
- alert on mismatch

### Security [MVP]
- RBAC
- service tokens
- encrypted PII
- masked logs
- no card storage

### Deployment Safety [OPS]
- zero‑downtime rollout
- worker drain
- post‑deploy canary

---
