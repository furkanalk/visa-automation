## Scope Labels

This document defines **zero-downtime deployment strategy**.

- **[MVP REQUIRED]** → required for safe production releases
- **[OPS]** → operational safety checks & tuning
- **[PHASED / LATER]** → optional optimizations

This is a deployment safety guide. Do not remove steps or rollback logic.

---

# Zero-Downtime Deployments (Docker Compose + Kong OSS)

## Blue/Green + Canary + Worker Drain Playbook

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [CI/CD Pipeline](../operations/VISA_CICD_PIPELINE.md) | [Docker Production Guide](../operations/VISA_DOCKER_COMPOSE_PRODUCTION.md) | [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md)

---

## Table of Contents

1. [Scope](#1-scope)
2. [Key Principles](#2-key-principles)
3. [Kong as Load Balancer](#3-kong-as-the-only-load-balancer)
4. [API Blue/Green Deployment](#4-api-bluegreen-deployment)
5. [Canary Deployment](#5-canary-deployment-optional)
6. [Database Migrations](#6-database-migrations-for-zero-downtime)
7. [Worker Upgrades](#7-worker-upgrade-zero-loss-via-drain)
8. [Pre-Flight Checklist](#8-operational-checklist-pre-flight)
9. [Rollback Procedures](#9-rollback-procedures)
10. [Deployment Scripts](#10-deployment-scripts)

---

## 1. Scope

This guide defines **how to ship upgrades with zero downtime for the API** and **zero-loss for workers** in a **single-server Docker Compose** production environment using **Kong OSS** as the edge gateway.

### What This Guide Covers

| Component | Strategy | Downtime |
|-----------|----------|----------|
| **API Service** | Blue/Green via Kong | Zero |
| **Worker Service** | Drain + Replace | Zero job loss |
| **Database Migrations** | Expand → Contract | Zero |
| **Configuration Changes** | Rolling restart | Minimal (seconds) |

### Important Limitations

> **Note:** Docker Compose alone does not provide native rolling updates or canary deployments. We achieve controlled rollout via **Kong upstream routing** plus **parallel service instances**.

---

## 2. Key Principles

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     ZERO-DOWNTIME DEPLOYMENT PRINCIPLES                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. API ZERO-DOWNTIME                                                   │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Run old and new API versions in parallel (Blue/Green)                │    │
│  │  • Switch traffic at the gateway level (Kong)                           │    │
│  │  • Old version handles in-flight requests                               │    │
│  │  • No dropped connections                                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  2. WORKER ZERO-LOSS                                                    │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Drain in-flight work before stopping workers                         │    │
│  │  • No partial work left behind                                          │    │
│  │  • Jobs transition to PAUSED, not FAILED                                │    │
│  │  • Graceful shutdown with SIGTERM                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  3. DATABASE SAFETY                                                     │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Use Expand → Contract migrations                                     │    │
│  │  • Old and new API can run simultaneously                               │    │
│  │  • Never deploy breaking schema changes mid-deployment                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Kong as the Only Load Balancer

### 3.1 Why Kong is Sufficient

For a single-host setup, **Kong upstreams can load-balance** across multiple API containers, and canary deployment can be implemented by adjusting upstream targets/weights.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        KONG LOAD BALANCING ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                              INTERNET                                            │
│                                  │                                               │
│                                  ▼                                               │
│                        ┌─────────────────┐                                      │
│                        │      Kong       │                                      │
│                        │   (Gateway)     │                                      │
│                        └────────┬────────┘                                      │
│                                 │                                                │
│                                 │ Upstream: api_upstream                         │
│                                 │                                                │
│                    ┌────────────┴────────────┐                                  │
│                    │                         │                                   │
│                    ▼                         ▼                                   │
│            ┌─────────────┐           ┌─────────────┐                            │
│            │  API Blue   │           │  API Green  │                            │
│            │  (Current)  │           │   (New)     │                            │
│            │             │           │             │                            │
│            │ Weight: 100 │           │ Weight: 0   │                            │
│            └─────────────┘           └─────────────┘                            │
│                                                                                  │
│  Traffic Flow:                                                                   │
│  1. Initially: 100% → Blue                                                      │
│  2. Deploy Green, health check passes                                           │
│  3. Switch: 100% → Green, 0% → Blue                                             │
│  4. Verify Green is healthy                                                      │
│  5. Remove Blue                                                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 What This Does NOT Solve

| Limitation | Description |
|------------|-------------|
| **Host-level SPOF** | The VM is still a single point of failure |
| **Multi-AZ / Multi-node HA** | Out of scope for single-server constraint |
| **L4 Failover** | Not needed for this design |

**Conclusion:** Kong upstream load balancing is enough for this architecture. No additional load balancer is required.

---

## 4. API Blue/Green Deployment

Blue/Green deployment runs two versions simultaneously and switches traffic at the gateway level.

### 4.1 Compose Model

Run two API services simultaneously:

```yaml
# docker-compose.yml (production with blue/green)
services:
  api_blue:
    image: ${REGISTRY}/visa-api:${BLUE_TAG}
    # ... full configuration
    networks:
      - internal

  api_green:
    image: ${REGISTRY}/visa-api:${GREEN_TAG}
    # ... full configuration
    networks:
      - internal
```

Both are registered as targets in **one Kong upstream** (e.g., `api_upstream`).

### 4.2 Deployment Steps (Blue → Green)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        BLUE/GREEN DEPLOYMENT FLOW                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  CURRENT STATE: Blue is live (100% traffic)                                      │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: PULL NEW IMAGE                                                 │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  docker compose pull api_green                                          │    │
│  │                                                                         │    │
│  │  Downloads the new image without affecting Blue                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: START GREEN                                                    │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  docker compose up -d --no-deps api_green                               │    │
│  │                                                                         │    │
│  │  Green starts but receives no traffic yet                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 3: WAIT FOR HEALTH CHECK                                          │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  docker inspect --format='{{json .State.Health}}' api_green             │    │
│  │                                                                         │    │
│  │  Wait until status shows "healthy"                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 4: REGISTER GREEN IN KONG (0% traffic initially)                  │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  curl -X POST http://localhost:8001/upstreams/api_upstream/targets \    │    │
│  │    -d "target=api_green:3000" -d "weight=0"                             │    │
│  │                                                                         │    │
│  │  Green is now known to Kong but receives no traffic                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 5: SWITCH TRAFFIC TO GREEN                                        │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  # Set Green to 100%                                                    │    │
│  │  curl -X PATCH http://localhost:8001/upstreams/api_upstream/targets/... │    │
│  │    -d "weight=100"                                                      │    │
│  │                                                                         │    │
│  │  # Set Blue to 0%                                                       │    │
│  │  curl -X PATCH http://localhost:8001/upstreams/api_upstream/targets/... │    │
│  │    -d "weight=0"                                                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 6: OBSERVE (5-10 minutes)                                         │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Monitor:                                                               │    │
│  │  • 5xx rate (should be near zero)                                       │    │
│  │  • p95 latency (should be stable)                                       │    │
│  │  • Error logs (check for new errors)                                    │    │
│  │  • DB errors / migration warnings                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ├─── If problems ──▶ ROLLBACK (see Step 4.3)                              │
│       │                                                                          │
│       ▼ If healthy                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 7: REMOVE BLUE                                                    │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  docker compose stop api_blue                                           │    │
│  │  docker compose rm -f api_blue                                          │    │
│  │                                                                         │    │
│  │  Blue is removed, Green is now the only API                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  FINAL STATE: Green is live (100% traffic), Blue removed                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Instant Rollback

Rollback is a **gateway traffic switch**, not an image rollback:

```bash
# If Green has issues, switch traffic back to Blue
# Set Blue back to 100%
curl -X PATCH "http://localhost:8001/upstreams/api_upstream/targets/${BLUE_TARGET_ID}" \
  -d "weight=100"

# Set Green to 0%
curl -X PATCH "http://localhost:8001/upstreams/api_upstream/targets/${GREEN_TARGET_ID}" \
  -d "weight=0"

# Green is now receiving no traffic
# Keep Green running for debugging if needed
# Remove Green later after analysis
```

**Key Insight:** Rollback takes seconds because it's just a weight change in Kong. No containers need to be restarted.

---

## 5. Canary Deployment (Optional)

Canary deployment is the same as Blue/Green, except traffic is moved gradually instead of all at once.

### 5.1 Suggested Ramp Schedule

| Phase | Green Weight | Blue Weight | Duration | Checkpoint |
|-------|--------------|-------------|----------|------------|
| 1 | 5% | 95% | 5-15 min | No errors? |
| 2 | 20% | 80% | 15 min | Latency stable? |
| 3 | 50% | 50% | 15 min | Full feature test |
| 4 | 100% | 0% | - | Complete |

### 5.2 Canary Traffic Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CANARY DEPLOYMENT PHASES                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Phase 1: 5% / 95%                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Traffic: ████████████████████████████████████████████████░░            │    │
│  │           Blue (95%)                                      Green (5%)    │    │
│  │                                                                         │    │
│  │  Monitor: Error rate, response time                                     │    │
│  │  Duration: 5-15 minutes                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  Phase 2: 20% / 80%                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Traffic: ████████████████████████████████████████░░░░░░░░░░            │    │
│  │           Blue (80%)                              Green (20%)           │    │
│  │                                                                         │    │
│  │  Monitor: Database load, memory usage                                   │    │
│  │  Duration: 15 minutes                                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  Phase 3: 50% / 50%                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Traffic: █████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░            │    │
│  │           Blue (50%)              Green (50%)                           │    │
│  │                                                                         │    │
│  │  Monitor: Full feature functionality                                    │    │
│  │  Duration: 15 minutes                                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  Phase 4: 0% / 100%                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Traffic: ░░░░░░░░░░░░░░░░░░░░░░░░░████████████████████████████████████ │    │
│  │           Blue (0%)               Green (100%)                          │    │
│  │                                                                         │    │
│  │  Deployment complete                                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Rollback During Canary

If SLOs degrade at any phase:

```bash
# Immediately revert to 100% Blue
curl -X PATCH "http://localhost:8001/upstreams/api_upstream/targets/${BLUE_TARGET_ID}" \
  -d "weight=100"

curl -X PATCH "http://localhost:8001/upstreams/api_upstream/targets/${GREEN_TARGET_ID}" \
  -d "weight=0"

# Keep Green running for debugging
docker compose logs api_green > /tmp/green-failure-logs.txt
```

---

## 6. Database Migrations for Zero-Downtime

### 6.1 The Expand → Contract Pattern

Database schema changes must be deployed in two phases to allow Blue and Green to coexist.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        EXPAND → CONTRACT MIGRATION                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PHASE 1: EXPAND (Compatible with both old and new code)                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Actions:                                                               │    │
│  │  • Add new columns with NULL default or sensible default                │    │
│  │  • Add new tables                                                       │    │
│  │  • Add indexes CONCURRENTLY (non-blocking)                              │    │
│  │                                                                         │    │
│  │  Constraints:                                                           │    │
│  │  • Old code can ignore new columns                                      │    │
│  │  • New code can read old + new schema                                   │    │
│  │                                                                         │    │
│  │  Timeline: Run migration BEFORE deploying new API                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Deploy new API (Blue/Green)                                              │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  COEXISTENCE PERIOD                                                     │    │
│  │  • Blue (old) and Green (new) run simultaneously                        │    │
│  │  • Both can read/write the schema                                       │    │
│  │  • New columns may be partially populated                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Traffic fully on Green, Blue removed                                     │
│       ▼                                                                          │
│  PHASE 2: CONTRACT (Only run after old code is completely gone)                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Actions:                                                               │    │
│  │  • Remove deprecated columns                                            │    │
│  │  • Drop old tables                                                      │    │
│  │  • Add NOT NULL constraints                                             │    │
│  │  • Remove unused indexes                                                │    │
│  │                                                                         │    │
│  │  Timeline: Run AFTER old code is fully decommissioned                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Migration Examples

**Adding a New Column (Safe):**
```sql
-- EXPAND phase: Run before deployment
ALTER TABLE jobs ADD COLUMN metadata JSONB;
-- No default needed, NULL is OK

-- New code can use it, old code ignores it
```

**Renaming a Column (Two-Phase):**
```sql
-- EXPAND phase: Add new column, copy data
ALTER TABLE jobs ADD COLUMN full_name TEXT;
UPDATE jobs SET full_name = name WHERE full_name IS NULL;

-- Deploy new code that writes to both columns

-- CONTRACT phase (after old code removed): Drop old column
ALTER TABLE jobs DROP COLUMN name;
```

### 6.3 Critical Rule

> **Rule:** Never deploy breaking DB changes while blue+green must coexist.

| Change Type | Safe During Blue/Green? | Strategy |
|-------------|------------------------|----------|
| Add column (nullable) | ✅ Yes | Deploy migration first |
| Add table | ✅ Yes | Deploy migration first |
| Add index | ✅ Yes | Use CONCURRENTLY |
| Rename column | ⚠️ Two-phase | Add new, migrate, remove old |
| Drop column | ❌ Contract only | Wait until old code removed |
| Change column type | ❌ Contract only | Add new column, migrate, drop old |

### 6.4 Migration Discipline Checklist (HARD RULES)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│               MIGRATION DISCIPLINE CHECKLIST (Pre-Merge Gate)                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ❌ FORBIDDEN OPERATIONS (Never in a single deployment)                          │
│  ────────────────────────────────────────────────────────────────────────────── │
│  □ RENAME column                                                                │
│  □ DROP column                                                                   │
│  □ ALTER column type                                                            │
│  □ DROP table                                                                    │
│  □ ADD NOT NULL constraint (without default)                                    │
│  □ CHANGE enum values (remove or rename)                                        │
│                                                                                  │
│  ✅ ALLOWED OPERATIONS (Single deployment OK)                                    │
│  ────────────────────────────────────────────────────────────────────────────── │
│  □ ADD column (nullable OR with default)                                        │
│  □ ADD table                                                                     │
│  □ ADD index CONCURRENTLY                                                       │
│  □ ADD enum value (at end)                                                      │
│  □ ADD foreign key (if column already nullable)                                 │
│                                                                                  │
│  ⚠️ TWO-PHASE OPERATIONS (Requires planning)                                    │
│  ────────────────────────────────────────────────────────────────────────────── │
│  Phase 1 (Expand):                                                              │
│    □ Add new column/table                                                       │
│    □ Deploy code that writes to BOTH old and new                                │
│    □ Backfill data if needed                                                    │
│    □ Wait for all old code instances to be replaced                             │
│                                                                                  │
│  Phase 2 (Contract) — MINIMUM 7 DAYS after Phase 1:                             │
│    □ Verify no old code is running                                              │
│    □ Remove writes to old column                                                │
│    □ DROP old column/table                                                      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Code Review Checklist for Migrations:**

- [ ] Migration file reviewed by at least 1 other engineer
- [ ] Migration tested on staging with Blue/Green simulation
- [ ] Rollback plan documented (what to do if migration fails)
- [ ] CONTRACT migrations have a scheduled date (not immediate)
- [ ] Large data migrations use batching (not single UPDATE)
- [ ] Index creation uses `CONCURRENTLY` (non-blocking)

**Example PR Template for Migrations:**

```markdown
## Migration Type
- [ ] EXPAND (safe, deploy first)
- [ ] CONTRACT (requires old code removal first)

## Changes
- What columns/tables are being modified?

## Backward Compatibility
- Can old code still function with this schema? YES / NO
- If NO, this is a CONTRACT migration and requires scheduling.

## Rollback Plan
- What SQL reverts this migration?
- Are there data concerns with rollback?
```

---

## 7. Worker Upgrade: Zero-Loss via Drain

### 7.1 Goal

Workers must not drop in-flight work. This is achieved through:

1. **SIGTERM handling:** Workers stop polling, checkpoint, release lease, transition to PAUSED
2. **Incident mode flags:** `DRAIN_ONLY` or `PAUSE_ALL` to control job intake

### 7.2 Worker Upgrade Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          WORKER UPGRADE FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: ENABLE DRAIN_ONLY MODE                                         │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  curl -X POST http://localhost:3000/admin/incident-mode \               │    │
│  │    -d '{"mode": "DRAIN_ONLY"}'                                          │    │
│  │                                                                         │    │
│  │  Effect: API stops admitting new jobs to queue                          │    │
│  │          Existing jobs continue processing                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: WAIT FOR DRAIN                                                 │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Monitor: Grafana → Worker Health → Active Runs                         │    │
│  │                                                                         │    │
│  │  Wait until:                                                            │    │
│  │  • active_runs is near zero (or below threshold)                        │    │
│  │  • Queue depth is acceptable                                            │    │
│  │                                                                         │    │
│  │  Command to check:                                                      │    │
│  │  docker compose exec redis redis-cli LLEN visa:queue:jobs               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 3: UPGRADE WORKERS                                                │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  docker compose pull worker                                             │    │
│  │  docker compose up -d --no-deps worker                                  │    │
│  │                                                                         │    │
│  │  Workers receive SIGTERM:                                               │    │
│  │  1. Stop polling for new jobs                                           │    │
│  │  2. Checkpoint current progress                                         │    │
│  │  3. Release lease                                                       │    │
│  │  4. Transition active jobs to PAUSED                                    │    │
│  │  5. Exit cleanly                                                        │    │
│  │                                                                         │    │
│  │  New workers start:                                                     │    │
│  │  1. Connect to Redis/DB                                                 │    │
│  │  2. Begin polling queue                                                 │    │
│  │  3. Pick up PAUSED jobs and resume                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 4: DISABLE DRAIN MODE                                             │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  curl -X POST http://localhost:3000/admin/incident-mode \               │    │
│  │    -d '{"mode": "NORMAL"}'                                              │    │
│  │                                                                         │    │
│  │  Effect: API resumes accepting new jobs                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 5: VERIFY NORMAL OPERATION                                        │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Monitor:                                                               │    │
│  │  • Queue depth returning to normal                                      │    │
│  │  • Workers showing active_runs > 0                                      │    │
│  │  • No errors in worker logs                                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Why No Canary for Workers

Workers don't need canary deployment because:

1. **No external traffic routing:** Workers pull from queue, not receive requests
2. **Drain ensures clean handoff:** Active jobs are checkpointed
3. **Resume capability:** New workers pick up where old ones left off

---

## 8. Operational Checklist (Pre-Flight)

### Before Any Deployment

| Check | Command/Method | Expected |
|-------|----------------|----------|
| ✅ Green healthcheck passes | `docker compose ps api_green` | Status: healthy |
| ✅ Kong upstream targets correct | `curl localhost:8001/upstreams/api_upstream/targets` | Both Blue and Green listed |
| ✅ Metrics visible | Check Grafana | Dashboards loading |
| ✅ Logs visible | Check Loki/log stream | Recent logs present |
| ✅ Migration is backward compatible | Review migration script | Expand phase only |
| ✅ Rollback path tested | Documented and understood | - |
| ✅ On-call notified | Slack/PagerDuty | Acknowledged |

### Deployment Verification Script

```bash
#!/bin/bash
# pre-flight-check.sh

set -e

echo "=== Pre-Flight Check ==="

# Check Green is healthy
echo "Checking Green health..."
HEALTH=$(docker inspect --format='{{.State.Health.Status}}' api_green 2>/dev/null || echo "not_running")
if [ "$HEALTH" != "healthy" ]; then
  echo "❌ Green is not healthy: $HEALTH"
  exit 1
fi
echo "✅ Green is healthy"

# Check Kong upstream
echo "Checking Kong upstream..."
TARGETS=$(curl -s localhost:8001/upstreams/api_upstream/targets | jq '.data | length')
if [ "$TARGETS" -lt 1 ]; then
  echo "❌ No targets in Kong upstream"
  exit 1
fi
echo "✅ Kong upstream has $TARGETS targets"

# Check database connectivity
echo "Checking database..."
docker compose exec -T api npm run db:check || {
  echo "❌ Database check failed"
  exit 1
}
echo "✅ Database OK"

# Check Redis connectivity
echo "Checking Redis..."
docker compose exec -T redis redis-cli ping | grep -q PONG || {
  echo "❌ Redis check failed"
  exit 1
}
echo "✅ Redis OK"

echo "=== All checks passed ==="
```

---

## 9. Rollback Procedures

### API Rollback (Instant)

```bash
#!/bin/bash
# rollback-api.sh

echo "Rolling back API to Blue..."

# Switch traffic to Blue (assuming Blue is still running)
curl -X PATCH "http://localhost:8001/upstreams/api_upstream/targets/${BLUE_TARGET_ID}" \
  -d "weight=100"

curl -X PATCH "http://localhost:8001/upstreams/api_upstream/targets/${GREEN_TARGET_ID}" \
  -d "weight=0"

echo "Traffic switched to Blue"
echo "Green is still running for debugging"
echo "Run 'docker compose stop api_green' when ready to remove"
```

### Worker Rollback

```bash
#!/bin/bash
# rollback-worker.sh

echo "Rolling back workers..."

# Enable drain mode
curl -X POST http://localhost:3000/admin/incident-mode \
  -d '{"mode": "DRAIN_ONLY"}'

# Wait for current jobs to complete/pause
echo "Waiting for workers to drain..."
sleep 60

# Revert to previous image
export WORKER_TAG="${PREVIOUS_WORKER_TAG}"
docker compose pull worker
docker compose up -d --no-deps worker

# Resume normal mode
curl -X POST http://localhost:3000/admin/incident-mode \
  -d '{"mode": "NORMAL"}'

echo "Workers rolled back to ${PREVIOUS_WORKER_TAG}"
```

### Database Rollback

> ⚠️ Database rollbacks are complex and should be avoided by using proper Expand → Contract migrations.

If a database rollback is truly needed:
1. Restore from backup (drastic)
2. Deploy a "reverse migration" that undoes the change
3. Revert API to version compatible with old schema

---

## 10. Deployment Scripts

### Complete Blue/Green Deployment Script

```bash
#!/bin/bash
# deploy-blue-green.sh
# Usage: ./deploy-blue-green.sh <new-image-tag>

set -euo pipefail

NEW_TAG="${1:?Usage: $0 <new-image-tag>}"
KONG_ADMIN="http://localhost:8001"
UPSTREAM="api_upstream"

echo "=== Blue/Green Deployment ==="
echo "Deploying: ${NEW_TAG}"

# Determine current active color
CURRENT_BLUE_WEIGHT=$(curl -s "${KONG_ADMIN}/upstreams/${UPSTREAM}/targets" | \
  jq -r '.data[] | select(.target | contains("blue")) | .weight')

if [ "$CURRENT_BLUE_WEIGHT" == "100" ]; then
  ACTIVE="blue"
  STANDBY="green"
else
  ACTIVE="green"
  STANDBY="blue"
fi

echo "Current active: ${ACTIVE}"
echo "Deploying to: ${STANDBY}"

# Update standby image tag
export ${STANDBY^^}_TAG="${NEW_TAG}"

# Pull new image
echo "Pulling new image..."
docker compose pull "api_${STANDBY}"

# Start standby
echo "Starting ${STANDBY}..."
docker compose up -d --no-deps "api_${STANDBY}"

# Wait for health check
echo "Waiting for health check..."
for i in {1..30}; do
  HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "api_${STANDBY}" 2>/dev/null || echo "starting")
  if [ "$HEALTH" == "healthy" ]; then
    echo "✅ ${STANDBY} is healthy"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "❌ Health check timeout"
    exit 1
  fi
  sleep 10
done

# Register in Kong (if not exists)
STANDBY_TARGET_ID=$(curl -s "${KONG_ADMIN}/upstreams/${UPSTREAM}/targets" | \
  jq -r ".data[] | select(.target | contains(\"${STANDBY}\")) | .id")

if [ -z "$STANDBY_TARGET_ID" ]; then
  echo "Registering ${STANDBY} in Kong..."
  curl -X POST "${KONG_ADMIN}/upstreams/${UPSTREAM}/targets" \
    -d "target=api_${STANDBY}:3000" -d "weight=0"
fi

# Switch traffic
echo "Switching traffic to ${STANDBY}..."
STANDBY_TARGET_ID=$(curl -s "${KONG_ADMIN}/upstreams/${UPSTREAM}/targets" | \
  jq -r ".data[] | select(.target | contains(\"${STANDBY}\")) | .id")
ACTIVE_TARGET_ID=$(curl -s "${KONG_ADMIN}/upstreams/${UPSTREAM}/targets" | \
  jq -r ".data[] | select(.target | contains(\"${ACTIVE}\")) | .id")

curl -X PATCH "${KONG_ADMIN}/upstreams/${UPSTREAM}/targets/${STANDBY_TARGET_ID}" -d "weight=100"
curl -X PATCH "${KONG_ADMIN}/upstreams/${UPSTREAM}/targets/${ACTIVE_TARGET_ID}" -d "weight=0"

echo "✅ Traffic switched to ${STANDBY}"
echo ""
echo "Monitoring for 5 minutes..."
echo "Run './rollback-api.sh' if issues detected"
echo ""
echo "After verification, remove old container:"
echo "  docker compose stop api_${ACTIVE}"
echo "  docker compose rm -f api_${ACTIVE}"
```

---

## Deliverable

This guide is the **official deployment standard** for production releases under the single-server constraint. Follow these procedures for all production deployments to ensure zero downtime for API services and zero job loss for workers.


---

## Architecture Notes

### Canary Validation (Required) [MVP REQUIRED]
After switching traffic to the new version:
- run portal canary job(s)
- verify selectors/DOM
- verify login/critical steps
- rollback immediately if canary fails

Prevents broken portal adapters reaching production.

### Agent / Worker Scaling Safety [OPS]
When scaling workers during deployment:
- increase gradually
- respect portal concurrency limits (SERIAL/PARALLEL)
- monitor 403/429

Sudden scale-up may trigger bans.

### Incident Linkage [OPS]
If error rate or bans spike post-deploy:
Follow Production Runbook → "Portal Rate Limit / IP Ban" scenario.

---
