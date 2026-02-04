## Scope Labels

This document defines the **technology & infrastructure reference architecture**.

Sections are labeled:

- **[MVP REQUIRED]** → must exist for first production deployment
- **[PHASED / LATER]** → future scale or enterprise hardening
- **[OPS]** → operational/monitoring best practices

This file is a **reference spec**, not a checklist. Do not trim core technical detail.

---

# Technology Stack & System Architecture

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md) | [Docker Production Guide](../operations/VISA_DOCKER_COMPOSE_PRODUCTION.md) | [CI/CD Pipeline](../operations/VISA_CICD_PIPELINE.md)

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Core Technologies](#2-core-technologies)
3. [Infrastructure](#3-infrastructure)
4. [Observability](#4-observability)
5. [Environments & Lifecycle](#5-environments--lifecycle)
6. [Infrastructure Provisioning](#6-infrastructure-provisioning)
7. [Operational Model](#7-operational-model)
8. [Design Outcome](#8-design-outcome)
9. [Data Lifecycle & Storage Flows](#9-data-lifecycle--storage-flows)

---

## 1. High-Level Architecture

The system is designed as a **single-server, containerized SaaS** with strict isolation, deterministic processing, and cloud-hosted observability.

### Architecture Diagram

```
                                    ┌─────────────────────────────────────────────────────────────────┐
                                    │                         INTERNET                                │
                                    └─────────────────────────────────────────────────────────────────┘
                                                              │
                                                              │ HTTPS (Port 443)
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                              SINGLE SERVER (VM)                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                         EDGE NETWORK                                                          │  │
│  │                                    ┌─────────────────────┐                                                    │  │
│  │                                    │   Kong OSS Gateway  │                                                    │  │
│  │                                    │  ─────────────────  │                                                    │  │
│  │                                    │  • TLS Termination  │                                                    │  │
│  │                                    │  • Authentication   │                                                    │  │
│  │                                    │  • Rate Limiting    │                                                    │  │
│  │                                    │  • Load Balancing   │                                                    │  │
│  │                                    └──────────┬──────────┘                                                    │  │
│  └───────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┘  │
│                                                  │                                                                   │
│  ┌───────────────────────────────────────────────┼───────────────────────────────────────────────────────────────┐  │
│  │                                         INTERNAL NETWORK                                                      │  │
│  │                                                  │                                                            │  │
│  │           ┌──────────────────────────────────────┼──────────────────────────────────────┐                     │  │
│  │           │                                      │                                      │                     │  │
│  │           ▼                                      ▼                                      ▼                     │  │
│  │  ┌─────────────────┐                   ┌─────────────────┐                    ┌─────────────────┐             │  │
│  │  │   API Service   │                   │  Worker Service │                    │  Worker Service │             │  │
│  │  │  ─────────────  │                   │  ─────────────  │                    │  ─────────────  │             │  │
│  │  │  Node.js (TS)   │                   │  Playwright     │                    │  Playwright     │             │  │
│  │  │  Express/Fastify│                   │  Browser Auto   │        ...         │  Browser Auto   │             │  │
│  │  │  REST API       │                   │  FSM Execution  │                    │  FSM Execution  │             │  │
│  │  └────────┬────────┘                   └────────┬────────┘                    └────────┬────────┘             │  │
│  │           │                                     │                                      │                      │  │
│  │           │                                     └──────────────────┬───────────────────┘                      │  │
│  │           │                                                        │                                          │  │
│  │           ▼                                                        ▼                                          │  │
│  │  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐     │  │
│  │  │                                        DATA LAYER                                                    │     │  │
│  │  │                                                                                                      │     │  │
│  │  │   ┌─────────────────────┐                              ┌─────────────────────┐                      │     │  │
│  │  │   │     PostgreSQL      │                              │       Redis         │                      │     │  │
│  │  │   │  ─────────────────  │                              │  ─────────────────  │                      │     │  │
│  │  │   │  • Jobs & State     │                              │  • BullMQ Queues    │                      │     │  │
│  │  │   │  • Tenants          │                              │  • Lease Management │                      │     │  │
│  │  │   │  • HITL Tasks       │                              │  • Pub/Sub          │                      │     │  │
│  │  │   │  • Audit Events     │                              │  • Caching          │                      │     │  │
│  │  │   └─────────────────────┘                              └─────────────────────┘                      │     │  │
│  │  │                                                                                                      │     │  │
│  │  └──────────────────────────────────────────────────────────────────────────────────────────────────────┘     │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                          │
                          │ Metrics (remote_write), Logs (push), Traces (OTLP)
                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                        EXTERNAL OBSERVABILITY STACK                                                  │
│                                                                                                                      │
│   ┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐                                   │
│   │   Prometheus    │           │      Loki       │           │     Grafana     │                                   │
│   │    (Metrics)    │           │     (Logs)      │           │  (Dashboards)   │                                   │
│   └─────────────────┘           └─────────────────┘           └─────────────────┘                                   │
│                                                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Component Summary

| Component | Role | Technology |
|-----------|------|------------|
| **Edge Gateway** | TLS, auth, rate limiting | Kong OSS |
| **API Service** | Business logic, REST endpoints | Node.js (TypeScript) |
| **Worker Service** | Browser automation, FSM execution | Playwright (TypeScript) |
| **Primary Database** | Jobs, state, audit logs | PostgreSQL |
| **Queue & Cache** | Job queue, leases, pub/sub | Redis + BullMQ |
| **Observability** | Metrics, logs, dashboards | Prometheus, Loki, Grafana (cloud-hosted) |

---

## 2. Core Technologies

### 2.1 Backend: Node.js with TypeScript

| Aspect | Details |
|--------|---------|
| **Runtime** | Node.js (LTS version) |
| **Language** | TypeScript with strict mode enabled |
| **Framework** | Express or Fastify for HTTP handling |
| **Validation** | Zod or similar for schema validation |

**Design Principles:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND DESIGN PRINCIPLES                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  DETERMINISTIC BUSINESS LOGIC                                           │    │
│  │  • Same inputs always produce same outputs                              │    │
│  │  • No hidden state or side effects                                      │    │
│  │  • Pure functions where possible                                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  IDEMPOTENT APIs                                                        │    │
│  │  • Retry-safe by design                                                 │    │
│  │  • Idempotency keys on mutations                                        │    │
│  │  • No duplicate side effects                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  SCHEMA-VALIDATED CONFIGURATION                                         │    │
│  │  • All config validated at startup                                      │    │
│  │  • Fail fast on misconfiguration                                        │    │
│  │  • Type-safe configuration access                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Queue & State: Redis + BullMQ

| Component | Purpose | Key Features |
|-----------|---------|--------------|
| **Redis** | In-memory data store | Persistence, pub/sub, atomic operations |
| **BullMQ** | Job queue library | Priority queues, delayed jobs, retries |

**Queue Capabilities:**

| Feature | Implementation | Benefit |
|---------|----------------|---------|
| **Lease-based ownership** | Redis SETNX with TTL | Prevents duplicate processing |
| **Retry budgets** | BullMQ attempts config | Controlled failure handling |
| **Dead Letter Queue** | BullMQ failed job handling | No lost jobs |
| **Backpressure-aware enqueue** | Custom admission control | System stability |

### 2.3 Browser Automation: Playwright

| Aspect | Details |
|--------|---------|
| **Library** | Playwright (Microsoft) |
| **Language** | TypeScript |
| **Browser** | Chromium (headless or headed) |

**Human-like Interaction Layers:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      BROWSER AUTOMATION STRATEGY                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  The goal is to interact with target sites in a way that mimics human behavior  │
│  to avoid detection and ensure reliability.                                      │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  TIMING CONTROL                                                         │    │
│  │  • Randomized delays between actions                                    │    │
│  │  • Realistic page load wait times                                       │    │
│  │  • Variable typing speeds                                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  INPUT PACING                                                           │    │
│  │  • Character-by-character typing with delays                            │    │
│  │  • Mouse movements before clicks                                        │    │
│  │  • Natural scrolling behavior                                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  EXECUTION THROTTLING                                                   │    │
│  │  • Rate limiting requests to target sites                               │    │
│  │  • Concurrent session limits                                            │    │
│  │  • Respectful resource usage                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  SCALING NOTE:                                                                   │
│  Browser instances are the PRIMARY SCALING UNIT                                  │
│  • Each browser requires ~500MB-1GB RAM                                          │
│  • Worker count is determined by available memory                                │
│  • CPU is rarely the bottleneck                                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 Database: PostgreSQL

| Feature | Usage |
|---------|-------|
| **JSONB** | Flexible state storage, form data, metadata |
| **Append-only tables** | Audit/event logs for traceability |
| **Transactions** | Strong consistency for state changes |
| **Partitioning** | Time-based partitions for job_events |

**Why PostgreSQL:**

| Requirement | PostgreSQL Capability |
|-------------|----------------------|
| ACID compliance | Full transaction support |
| Flexible schema | JSONB for semi-structured data |
| Scalability | Partitioning, indexing, VACUUM |
| Reliability | Proven in production at scale |
| Ecosystem | Excellent tooling and support |

---

## 3. Infrastructure

### 3.1 Container Runtime

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Engine** | Docker Engine | Industry standard, well-supported |
| **Orchestration** | Docker Compose | Sufficient for single-server deployment |
| **Registry** | Docker Registry / Harbor | Private image storage |

**Why Docker Compose (Not Kubernetes):**

| Factor | Docker Compose | Kubernetes |
|--------|----------------|------------|
| Single-server deployment | ✅ Perfect fit | ❌ Overkill |
| Operational complexity | Low | High |
| Learning curve | Minimal | Significant |
| Resource overhead | Minimal | Significant |
| Feature set | Sufficient | Excessive |

### 3.2 Security Hardening

All production containers implement the following security measures:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        CONTAINER SECURITY LAYERS                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Layer 1: USER ISOLATION                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Non-root user (UID 1000)                                             │    │
│  │  • No privilege escalation possible                                     │    │
│  │  • Minimal file permissions                                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  Layer 2: FILESYSTEM RESTRICTIONS                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Read-only root filesystem                                            │    │
│  │  • tmpfs for /tmp and runtime paths                                     │    │
│  │  • No persistent writes except to volumes                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  Layer 3: CAPABILITY RESTRICTIONS                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • cap_drop: ALL                                                        │    │
│  │  • Only essential capabilities if needed                                │    │
│  │  • Minimal attack surface                                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  Layer 4: NETWORK ISOLATION                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Isolated Docker networks (edge, internal)                            │    │
│  │  • Services only communicate as needed                                  │    │
│  │  • No unnecessary port exposure                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  Layer 5: SECRETS MANAGEMENT                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Docker Secrets for sensitive data                                    │    │
│  │  • No plaintext in environment variables                                │    │
│  │  • Secrets mounted as files                                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

> **Detailed Configuration:** See [VISA_DOCKER_COMPOSE_PRODUCTION.md](../operations/VISA_DOCKER_COMPOSE_PRODUCTION.md)

### 3.3 Edge Gateway: Kong OSS

| Responsibility | Implementation |
|----------------|----------------|
| **TLS Termination** | Let's Encrypt certificates, automatic renewal |
| **Authentication** | JWT validation, tenant extraction |
| **Rate Limiting** | Per-tenant and global limits |
| **Request Filtering** | Size limits, content type validation |

**Security Model:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           KONG NETWORK TOPOLOGY                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│    INTERNET                                                                      │
│        │                                                                         │
│        │ Only port 443 exposed                                                   │
│        ▼                                                                         │
│  ┌─────────────┐                                                                │
│  │    Kong     │◀── Public-facing, handles all external traffic                 │
│  └──────┬──────┘                                                                │
│         │                                                                        │
│  ═══════╪════════════════════════════════════════════════════════════════════   │
│         │         INTERNAL NETWORK (Not accessible from internet)                │
│         │                                                                        │
│         ├─────────────▶ API Service (port 3000)                                 │
│         │                                                                        │
│         └─────────────▶ Kong Admin API (port 8001) ◀── NEVER EXPOSED            │
│                                                                                  │
│  Internal services communicate directly, bypassing Kong                          │
│  (e.g., Worker → PostgreSQL, API → Redis)                                       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Observability

### 4.1 Metrics: Prometheus Format

| Aspect | Details |
|--------|---------|
| **Format** | Prometheus exposition format |
| **Collection** | Application exposes /metrics endpoint |
| **Transport** | Remote write to cloud backend |
| **Retention** | Handled by cloud provider |

**Key Metrics Categories:**

| Category | Example Metrics |
|----------|-----------------|
| **Queue** | `queue_depth`, `job_wait_seconds`, `jobs_enqueued_total` |
| **Worker** | `active_runs`, `run_duration_seconds`, `heartbeat_lag_seconds` |
| **HITL** | `hitl_wait_seconds`, `hitl_expired_total` |
| **Errors** | `failed_retryable_total`, `failed_terminal_total` |

### 4.2 Logs: Structured JSON

| Aspect | Details |
|--------|---------|
| **Format** | Structured JSON (one line per log entry) |
| **Transport** | Pushed to remote Loki instance |
| **Correlation** | `tenant_id`, `job_id`, `run_id` in every log |

**Log Entry Example:**
```json
{
  "timestamp": "2026-01-25T10:30:00.000Z",
  "level": "info",
  "message": "Job state transition",
  "tenant_id": "tenant-123",
  "job_id": "job-456",
  "run_id": "run-789",
  "from_state": "FORM_FILLING",
  "to_state": "PROCESSING"
}
```

### 4.3 Tracing: OpenTelemetry

| Aspect | Details |
|--------|---------|
| **Protocol** | OTLP (OpenTelemetry Protocol) |
| **Instrumentation** | Auto-instrumentation + custom spans |
| **Correlation** | Trace context propagated across services |

**Trace Flow:**
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              TRACE PROPAGATION                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Request arrives at Kong                                                         │
│       │                                                                          │
│       │ trace_id: abc123                                                         │
│       ▼                                                                          │
│  API receives request                                                            │
│       │                                                                          │
│       │ trace_id: abc123, span_id: span-1                                        │
│       ▼                                                                          │
│  Job enqueued to Redis                                                           │
│       │                                                                          │
│       │ trace_id: abc123, span_id: span-2                                        │
│       ▼                                                                          │
│  Worker picks up job                                                             │
│       │                                                                          │
│       │ trace_id: abc123, span_id: span-3                                        │
│       ▼                                                                          │
│  Browser automation executes                                                     │
│       │                                                                          │
│       │ trace_id: abc123, span_id: span-4                                        │
│       ▼                                                                          │
│  Complete trace visible in Grafana                                               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Visualization & Alerts: Grafana

| Aspect | Details |
|--------|---------|
| **Hosting** | Grafana Cloud or dedicated monitoring VM |
| **Dashboards** | Pre-built dashboards for each component |
| **Alerting** | PagerDuty/Slack integration |

> **Dashboard Configuration:** See [VISA_GRAFANA_DASHBOARDS.md](../operations/VISA_GRAFANA_DASHBOARDS.md)

### 4.5 Minimum Local Telemetry (REQUIRED)

While Prometheus, Grafana, and Loki are cloud-hosted to preserve RAM for browser workers, the following **minimum local telemetry** is REQUIRED on the production server:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      MINIMUM LOCAL TELEMETRY REQUIREMENTS                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. CONTAINER LOGS → STDOUT (JSON)                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • All services MUST log to stdout in JSON format                       │    │
│  │  • Docker captures logs automatically                                   │    │
│  │  • Format: {"timestamp":"...","level":"...","msg":"...","job_id":"..."} │    │
│  │  • Enables: docker compose logs, log shipping to Loki                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  2. HOST METRICS (node_exporter or equivalent)                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • CPU, memory, disk usage                                              │    │
│  │  • Network I/O                                                          │    │
│  │  • Disk I/O and latency                                                 │    │
│  │  • MUST be available for incident diagnosis                             │    │
│  │  • Can be lightweight: node_exporter textfile collector                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  3. HEALTH ENDPOINT STANDARD                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Kong:   GET /health                → 200 if healthy                    │    │
│  │  API:    GET /health/ready          → 200 if ready (DB + Redis OK)      │    │
│  │          GET /health/live           → 200 if process alive              │    │
│  │  Worker: GET /health                → 200 if ready (Redis OK)           │    │
│  │                                                                         │    │
│  │  Response format:                                                       │    │
│  │  {                                                                      │    │
│  │    "status": "healthy",                                                 │    │
│  │    "checks": {                                                          │    │
│  │      "database": "ok",                                                  │    │
│  │      "redis": "ok",                                                     │    │
│  │      "disk_space": "ok"                                                 │    │
│  │    },                                                                   │    │
│  │    "version": "1.2.3",                                                  │    │
│  │    "uptime_seconds": 86400                                              │    │
│  │  }                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  4. DOCKER HEALTH CHECKS                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Every service MUST have healthcheck in docker-compose.yml            │    │
│  │  • Enables: docker compose ps shows health status                       │    │
│  │  • Enables: Docker restarts unhealthy containers                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Log Format Standard:**

```json
{
  "timestamp": "2026-01-25T10:30:00.000Z",
  "level": "info",
  "service": "api",
  "msg": "Job state transition",
  "tenant_id": "tenant-123",
  "job_id": "job-456",
  "run_id": "run-789",
  "from_state": "FORM_FILLING",
  "to_state": "PROCESSING",
  "duration_ms": 1523
}
```

**Health Check Implementation:**

```typescript
// Example: Express health endpoint
app.get('/health/ready', async (req, res) => {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    disk_space: checkDiskSpace()
  };
  
  const allHealthy = Object.values(checks).every(c => c === 'ok');
  
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'unhealthy',
    checks,
    version: process.env.APP_VERSION,
    uptime_seconds: process.uptime()
  });
});
```

**Why Local Telemetry Matters:**

| Scenario | Without Local Telemetry | With Local Telemetry |
|----------|------------------------|---------------------|
| Cloud observability down | Blind to system state | Can still diagnose via `docker compose logs` |
| Network partition | No metrics/logs shipped | Local logs preserved |
| Incident diagnosis | Must SSH and improvise | Standard commands work immediately |

---

## 5. Environments & Lifecycle

### 5.1 Environments

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            ENVIRONMENT PROGRESSION                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐                │
│  │   DEV   │─────▶│  TEST   │─────▶│  STAGE  │─────▶│  PROD   │                │
│  └─────────┘      └─────────┘      └─────────┘      └─────────┘                │
│       │                │                │                │                      │
│       ▼                ▼                ▼                ▼                      │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐                │
│  │Synthetic│      │  Test   │      │  Anon   │      │  Real   │                │
│  │  Data   │      │Fixtures │      │  Prod   │      │Customer │                │
│  └─────────┘      └─────────┘      └─────────┘      └─────────┘                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| Environment | Purpose | Data | Deployment Trigger |
|-------------|---------|------|-------------------|
| **dev** | Development, experimentation | Synthetic/mock data | Automatic on PR |
| **test** | Automated testing, CI | Test fixtures | Automatic on merge to main |
| **stage** | Pre-production validation | Anonymized production-like | Manual trigger |
| **prod** | Production | Real customer data | Manual approval required |

**Isolation Guarantees:**

Each environment has completely isolated:
- ✅ Configuration files (separate `.env` files)
- ✅ Secrets (separate Docker secrets)
- ✅ Data stores (separate databases)
- ✅ Network boundaries (no cross-env communication)

### 5.2 CI/CD

| Aspect | Details |
|--------|---------|
| **Source Control** | Git-based workflow (GitHub/GitLab) |
| **Image Strategy** | Tag-based promotion between environments |
| **Production Gates** | Manual approval required for prod deploys |

> **Detailed Pipeline:** See [VISA_CICD_PIPELINE.md](../operations/VISA_CICD_PIPELINE.md)

---

## 6. Infrastructure Provisioning

### 6.1 Terraform

All cloud infrastructure is defined and managed through Terraform:

| Resource Category | Examples |
|-------------------|----------|
| **Compute** | VM instances, instance types, availability |
| **Storage** | Block storage volumes, object storage buckets |
| **Networking** | VPCs, subnets, security groups, firewall rules |
| **DNS** | Domain records, SSL certificate management |

**Terraform Workflow:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TERRAFORM WORKFLOW                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. PLAN                                                                         │
│     ┌─────────────────────────────────────────────────────────────────────┐     │
│     │  terraform plan                                                      │     │
│     │  • Compare desired state (code) with actual state (cloud)           │     │
│     │  • Show what would change                                           │     │
│     │  • No changes made yet                                              │     │
│     └─────────────────────────────────────────────────────────────────────┘     │
│                              │                                                   │
│                              ▼                                                   │
│  2. REVIEW                                                                       │
│     ┌─────────────────────────────────────────────────────────────────────┐     │
│     │  Human reviews plan output                                           │     │
│     │  • Verify expected changes                                          │     │
│     │  • Check for unintended modifications                               │     │
│     │  • Approve or reject                                                │     │
│     └─────────────────────────────────────────────────────────────────────┘     │
│                              │                                                   │
│                              ▼                                                   │
│  3. APPLY                                                                        │
│     ┌─────────────────────────────────────────────────────────────────────┐     │
│     │  terraform apply                                                     │     │
│     │  • Execute planned changes                                          │     │
│     │  • Update state file                                                │     │
│     │  • Infrastructure now matches code                                  │     │
│     └─────────────────────────────────────────────────────────────────────┘     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Benefits:**

| Benefit | Description |
|---------|-------------|
| **Drift Prevention** | Actual state always matches declared state |
| **Reproducibility** | Identical environments from same configuration |
| **CI/CD Integration** | Infrastructure changes reviewed like code |
| **Disaster Recovery** | Entire infrastructure recreatable from code |
| **Documentation** | Infrastructure is self-documenting |

### 6.2 Secrets Lifecycle

| Aspect | Implementation |
|--------|----------------|
| **Storage** | Docker Secrets (file-based) |
| **Rotation** | Supported via secret versioning |
| **Access** | Only specified services can access each secret |
| **Audit** | Secret access logged |

**Secret Types:**

| Secret | Used By | Rotation Frequency |
|--------|---------|-------------------|
| `db_password` | API, Worker | Quarterly |
| `jwt_secret` | API, Kong | Annually |
| `kong_admin_token` | Deployment scripts | On compromise |
| `encryption_key` | Worker (HITL data) | Annually |

---

## 7. Operational Model

### 7.1 Scaling

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            SCALING MODEL                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  CONSTRAINT: Single-server deployment                                            │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  VERTICAL SCALING ONLY                                                  │    │
│  │  • Add more RAM to increase worker count                                │    │
│  │  • Add more CPU if needed (rarely the bottleneck)                       │    │
│  │  • Upgrade VM instance type                                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  WORKER CONCURRENCY                                                     │    │
│  │  • Strictly capped based on available RAM                               │    │
│  │  • Formula: max_workers = (available_RAM - system_overhead) / RAM_per_worker │
│  │  • Example: (16GB - 4GB) / 1.5GB = 8 workers max                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  QUEUE AS BUFFER                                                        │    │
│  │  • Queue absorbs burst traffic                                          │    │
│  │  • Does NOT increase processing capacity                                │    │
│  │  • Smooths out demand spikes                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Failure Handling

| Failure Type | Detection | Recovery |
|--------------|-----------|----------|
| **Worker crash** | Lease TTL expires, heartbeat missing | Job resumes on new worker from checkpoint |
| **Session loss** | External assertion fails | Re-authenticate, replay from checkpoint |
| **HITL timeout** | `expires_at` reached | Controlled transition to FAILED_RETRYABLE or FAILED_TERMINAL |
| **Infra restart** | Graceful SIGTERM | Jobs PAUSED, resume on restart |

**Recovery Flow:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          FAILURE RECOVERY FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Failure Detected                                                                │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Is checkpoint available?                                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ├─── YES ──▶ Resume from checkpoint (deterministic replay)                │
│       │                                                                          │
│       └─── NO ───▶ Start from beginning (rare, usually crash during init)       │
│                                                                                  │
│  Key Guarantees:                                                                 │
│  • No duplicate submissions to target site                                       │
│  • No lost progress                                                              │
│  • Full audit trail maintained                                                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Design Outcome

This technology stack is intentionally **conservative, explicit, and resilient**. It favors **predictability and operability** over novelty, ensuring long-term sustainability.

### Design Philosophy Summary

| Principle | Implementation |
|-----------|----------------|
| **Conservative choices** | Proven technologies (Node.js, PostgreSQL, Redis) |
| **Explicit behavior** | FSM with defined states, no hidden logic |
| **Resilient by design** | Checkpoints, leases, deterministic resume |
| **Predictable operations** | Clear monitoring, runbooks, incident modes |
| **Sustainable long-term** | Low operational complexity, good tooling ecosystem |

### What This Architecture Optimizes For

| Priority | How Achieved |
|----------|--------------|
| **Reliability** | Deterministic FSM, checkpoint-based resume |
| **Auditability** | Append-only event log, full traceability |
| **Operability** | Clear monitoring, incident modes, runbooks |
| **Simplicity** | Single-server, Docker Compose, proven tech |

### What This Architecture Does NOT Optimize For

| Non-Priority | Rationale |
|--------------|-----------|
| **Horizontal scaling** | Single-server constraint; not needed for workload |
| **Cutting-edge tech** | Stability over novelty |
| **Microservices** | Monolith simpler for this scale |

---

## 9. Data Lifecycle & Storage Flows

### 9.1 Job Event Lifecycle

The `job_events` table stores the complete history of every job, enabling debugging, auditing, and compliance.

| Phase | Duration | Storage | Purpose |
|-------|----------|---------|---------|
| **Active (Hot)** | 0-90 days | PostgreSQL (Partitioned) | Fast queries, debugging, real-time audits |
| **Archived (Cold)** | >90 days | Object Storage (Encrypted) | Compliance, forensic access, cost control |
| **Purged** | Per retention policy | N/A | Cost control (optional, depends on compliance needs) |

### 9.2 Job Execution Flow (Simplified)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         JOB EXECUTION FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Step │ Component   │ Action                                                    │
│  ─────┼─────────────┼─────────────────────────────────────────────────────────  │
│    1  │ API         │ Validates request, applies admission control              │
│       │             │ • Check tenant quota                                      │
│       │             │ • Verify idempotency key                                  │
│       │             │ • Validate request schema                                 │
│  ─────┼─────────────┼─────────────────────────────────────────────────────────  │
│    2  │ DB          │ Creates job + initial state                               │
│       │             │ • Insert into jobs table                                  │
│       │             │ • Write initial job_event                                 │
│       │             │ • State = DRAFTED → QUEUED                                │
│  ─────┼─────────────┼─────────────────────────────────────────────────────────  │
│    3  │ Queue       │ Enqueues job                                              │
│       │             │ • Add to BullMQ with priority                             │
│       │             │ • Respect backpressure limits                             │
│  ─────┼─────────────┼─────────────────────────────────────────────────────────  │
│    4  │ Worker      │ Acquires lease                                            │
│       │             │ • Get exclusive Redis lease                               │
│       │             │ • Create job_run record                                   │
│       │             │ • Start heartbeat                                         │
│  ─────┼─────────────┼─────────────────────────────────────────────────────────  │
│    5  │ Target Site │ Executes deterministic steps                              │
│       │             │ • Login → Form filling → Submission                       │
│       │             │ • Human-like interaction patterns                         │
│  ─────┼─────────────┼─────────────────────────────────────────────────────────  │
│    6  │ DB          │ Persists checkpoints & events                             │
│       │             │ • After each critical step                                │
│       │             │ • Enables deterministic resume                            │
│  ─────┼─────────────┼─────────────────────────────────────────────────────────  │
│    7  │ HITL        │ Optional human intervention                               │
│       │             │ • CAPTCHA, verification codes                             │
│       │             │ • SLA-bound with expiry                                   │
│  ─────┼─────────────┼─────────────────────────────────────────────────────────  │
│    8  │ Completion  │ Final state written                                       │
│       │             │ • State = COMPLETED or FAILED_*                           │
│       │             │ • Release lease                                           │
│       │             │ • Write final job_event                                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 9.3 Failure & Recovery Flow

| Scenario | Detection | Result | Data Integrity |
|----------|-----------|--------|----------------|
| **Worker crash** | Lease TTL expires, heartbeat stale | Job resumes on new worker from last checkpoint | ✅ Preserved |
| **Session loss** | External assertion fails | Re-authenticate + deterministic replay from checkpoint | ✅ Preserved |
| **HITL timeout** | `expires_at` reached | Controlled failure (FAILED_RETRYABLE or FAILED_TERMINAL) | ✅ Preserved |
| **Infra restart** | SIGTERM received | Jobs PAUSED, resume after restart | ✅ Preserved |

### 9.4 Why Tables & Flows Matter

These explicit documentation of data flows serves critical purposes:

| Purpose | Benefit |
|---------|---------|
| **Third-party review** | Architecture reviewable by auditors, consultants |
| **Knowledge sharing** | Reduces tribal knowledge, single points of failure |
| **Onboarding** | New team members understand system quickly |
| **Incident response** | Clear understanding speeds up debugging |
| **Compliance** | Demonstrates data handling to regulators |


---

## Agent Pools & Portal Policies [MVP REQUIRED]

To safely operate multiple visa portals and reduce ban/rate-limit risk:

- Workers are treated as **Agents**
- Each agent is assigned to one or more `portal_id`s
- Agents only pull jobs for assigned portals

Per-portal policy:
- mode: SERIAL | PARALLEL
- max_concurrency: integer
- request budgets (rpm/rph)
- circuit breaker thresholds

Behavior:
- SERIAL → only 1 active agent
- PARALLEL → up to N agents concurrently
- Circuit breaker → pause portal when error spike detected

---

## Portal Canary Monitoring [OPS]

To detect portal UI/DOM changes early:

- Schedule lightweight canary jobs per portal (30–60 min)
- Validate critical selectors/pages
- On mismatch → emit `portal.change_detected`
- Notify admins + attach screenshot/diff

Purpose:
- Prevent silent automation breakage
- Reduce emergency fixes

---
