## Scope Labels

This document defines **Grafana dashboards & observability strategy**.

- **[MVP REQUIRED]** → essential visibility for production safety
- **[OPS]** → operational tuning/extra metrics
- **[PHASED / LATER]** → future improvements

This is an observability reference. Do not remove critical metrics.

---

# Grafana Dashboards & Alerting Guide

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md) | [Production Runbook](../operations/VISA_PRODUCTION_RUNBOOK.md) | [Technology Stack](../architecture/VISA_SAAS_TECHNOLOGY_AND_SYSTEMS.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Dashboard Architecture](#dashboard-architecture)
3. [Core Dashboards](#core-dashboards)
   - [Queue Health Dashboard](#1-queue-health-dashboard)
   - [Worker Health Dashboard](#2-worker-health-dashboard)
   - [HITL Operations Dashboard](#3-hitl-operations-dashboard)
   - [Error Rates Dashboard](#4-error-rates-dashboard)
4. [Alert Configuration](#alert-configuration)
5. [Metric Reference](#metric-reference)
6. [Dashboard Examples](#dashboard-examples)

---

## Overview

This guide defines the Grafana dashboards and alerting configuration for monitoring the Visa Automation SaaS platform.

### Monitoring Philosophy

| Principle | Implementation |
|-----------|----------------|
| **Actionable alerts** | Every alert has a clear response action |
| **SLA-focused** | Metrics tied to business SLAs |
| **Hierarchical** | Overview → Details drill-down |
| **Proactive** | Detect issues before they impact users |

### Observability Stack

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          OBSERVABILITY ARCHITECTURE                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────┐                          ┌─────────────────────────────┐   │
│  │   API Service   │──── Metrics ────────────▶│                             │   │
│  │   /metrics      │                          │        Prometheus           │   │
│  └─────────────────┘                          │    (remote_write to         │   │
│                                               │     cloud backend)          │   │
│  ┌─────────────────┐                          │                             │   │
│  │  Worker Service │──── Metrics ────────────▶│                             │   │
│  │   /metrics      │                          └──────────────┬──────────────┘   │
│  └─────────────────┘                                         │                  │
│                                                              │                  │
│  ┌─────────────────┐                                         │                  │
│  │   All Services  │──── Logs ───────────────▶  Loki         │                  │
│  │   (JSON stdout) │                                         │                  │
│  └─────────────────┘                                         │                  │
│                                                              ▼                  │
│                                               ┌─────────────────────────────┐   │
│                                               │         Grafana             │   │
│                                               │  • Dashboards               │   │
│                                               │  • Alerts                   │   │
│                                               │  • Exploration              │   │
│                                               └─────────────────────────────┘   │
│                                                              │                  │
│                                                              ▼                  │
│                                               ┌─────────────────────────────┐   │
│                                               │    Alert Channels           │   │
│                                               │  • Slack                    │   │
│                                               │  • PagerDuty                │   │
│                                               │  • Email                    │   │
│                                               └─────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Dashboard Architecture

### Dashboard Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          DASHBOARD ORGANIZATION                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  LEVEL 1: EXECUTIVE OVERVIEW                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  System Health Overview                                                 │    │
│  │  • Overall system status (healthy/degraded/down)                        │    │
│  │  • Jobs completed today                                                 │    │
│  │  • Current queue depth                                                  │    │
│  │  • Active workers                                                       │    │
│  │  • Error rate (last hour)                                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                        │                                         │
│                                        ▼                                         │
│  LEVEL 2: OPERATIONAL DASHBOARDS                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │
│  │  Queue Health    │  │  Worker Health   │  │  HITL Operations │              │
│  │  ────────────    │  │  ────────────    │  │  ────────────    │              │
│  │  • Queue depth   │  │  • Active runs   │  │  • Pending tasks │              │
│  │  • Wait times    │  │  • Run duration  │  │  • Wait times    │              │
│  │  • Retry counts  │  │  • Heartbeats    │  │  • Expirations   │              │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘              │
│                                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                                    │
│  │  Error Rates     │  │  Tenant Metrics  │                                    │
│  │  ────────────    │  │  ────────────    │                                    │
│  │  • Retryable     │  │  • Per-tenant    │                                    │
│  │  • Terminal      │  │  • Quota usage   │                                    │
│  │  • By error type │  │  • Success rates │                                    │
│  └──────────────────┘  └──────────────────┘                                    │
│                                        │                                         │
│                                        ▼                                         │
│  LEVEL 3: DETAILED DRILL-DOWN                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Job Explorer                                                           │    │
│  │  • Individual job tracking                                              │    │
│  │  • State transition timeline                                            │    │
│  │  • Logs for specific job_id                                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Dashboards

### 1. Queue Health Dashboard

**Purpose:** Monitor the job queue to detect backlogs, processing delays, and capacity issues.

#### Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `queue_depth` | Gauge | Current number of jobs in queue | `status`, `priority`, `tenant_id` |
| `job_wait_seconds` | Histogram | Time from enqueue to worker pickup | `tenant_id`, `priority` |
| `retry_count` | Counter | Number of job retries | `tenant_id`, `reason` |
| `jobs_enqueued_total` | Counter | Total jobs enqueued | `tenant_id` |
| `jobs_dequeued_total` | Counter | Total jobs picked up by workers | `tenant_id` |

#### Dashboard Panels

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         QUEUE HEALTH DASHBOARD                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌───────────────────────────┐  ┌───────────────────────────┐                  │
│  │    QUEUE DEPTH (Gauge)    │  │  QUEUE TREND (Time Series) │                  │
│  │                           │  │                            │                  │
│  │         ┌────┐            │  │     ──────────────────     │                  │
│  │         │ 42 │            │  │    /                  \    │                  │
│  │         └────┘            │  │   /                    \   │                  │
│  │      Current depth        │  │  /                      \  │                  │
│  │                           │  │                            │                  │
│  └───────────────────────────┘  └───────────────────────────┘                  │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    JOB WAIT TIME (p95) - Time Series                      │  │
│  │                                                                            │  │
│  │   SLA Threshold ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ 30s        │  │
│  │                                                                            │  │
│  │   ════════════════════════════════════════════════════════════            │  │
│  │   12:00        12:30        13:00        13:30        14:00               │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    QUEUE BY PRIORITY - Stacked Area                        │  │
│  │                                                                            │  │
│  │   ████████████████████████████████ VIP                                    │  │
│  │   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ Normal                                  │  │
│  │   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ Low                                      │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    RETRY RATE - Time Series                                │  │
│  │                                                                            │  │
│  │   Retries per minute over time, broken down by reason                     │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Alerts

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| **Queue Backlog** | `queue_depth > 100` for 10 minutes | Warning | Check worker health |
| **Queue Critical** | `queue_depth > 500` for 5 minutes | Critical | Scale workers, investigate |
| **Wait Time SLA** | `job_wait_seconds p95 > 30s` for 5 minutes | Warning | Check worker capacity |
| **Retry Spike** | `rate(retry_count[5m]) > 10` | Warning | Investigate target site |

---

### 2. Worker Health Dashboard

**Purpose:** Monitor worker processes to detect crashes, stuck jobs, and performance issues.

#### Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `active_runs` | Gauge | Currently processing jobs | `worker_id` |
| `run_duration_seconds` | Histogram | Time to complete a job run | `final_state`, `tenant_id` |
| `heartbeat_lag_seconds` | Gauge | Time since last heartbeat | `worker_id`, `job_id` |
| `worker_ready` | Gauge | Worker is ready to accept jobs | `worker_id` |
| `browser_memory_bytes` | Gauge | Browser process memory usage | `worker_id` |

#### Dashboard Panels

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        WORKER HEALTH DASHBOARD                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ Active Workers │  │  Active Runs   │  │ Avg Duration   │  │  Heartbeat OK  │ │
│  │                │  │                │  │                │  │                │ │
│  │    ┌───┐       │  │    ┌───┐       │  │    ┌────┐      │  │    ┌───┐       │ │
│  │    │ 4 │       │  │    │ 3 │       │  │    │45s │      │  │    │ ✓ │       │ │
│  │    └───┘       │  │    └───┘       │  │    └────┘      │  │    └───┘       │ │
│  │   of 4 max     │  │   processing   │  │   per job      │  │   all healthy  │ │
│  └────────────────┘  └────────────────┘  └────────────────┘  └────────────────┘ │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    ACTIVE RUNS PER WORKER - Time Series                    │  │
│  │                                                                            │  │
│  │   worker-1: ═══════════════════════════════════════════                   │  │
│  │   worker-2: ════════════════════════════════════                          │  │
│  │   worker-3: ═════════════════════════════════════════════                 │  │
│  │   worker-4: ══════════════════════════════════════════════                │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    RUN DURATION DISTRIBUTION - Histogram                   │  │
│  │                                                                            │  │
│  │         ████                                                              │  │
│  │         ████ ███                                                          │  │
│  │     ██  ████ ███ ██                                                       │  │
│  │     ██  ████ ███ ██ █  █                                                  │  │
│  │   ──────────────────────────────────────                                  │  │
│  │   10s  30s  60s  90s  120s  150s  180s                                    │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    HEARTBEAT LAG - Time Series                             │  │
│  │                                                                            │  │
│  │   Alert threshold ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ 30s             │  │
│  │   _______________________________________________                          │  │
│  │   All workers healthy (lag < 15s)                                         │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Alerts

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| **Heartbeat Lag** | `heartbeat_lag_seconds > 30` (2× interval) | Critical | Worker likely crashed, check logs |
| **Workers Saturated** | `active_runs == max_concurrent_workers` for 30 minutes | Warning | Consider scaling |
| **Long Running Job** | `run_duration_seconds > 300` | Warning | May be stuck, investigate |
| **Worker Down** | `worker_ready == 0` for any worker | Critical | Restart worker |

---

### 3. HITL Operations Dashboard

**Purpose:** Monitor human-in-the-loop tasks to ensure SLA compliance and operator workload.

#### Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `hitl_pending_total` | Gauge | Tasks waiting for operator | `tenant_id` |
| `hitl_wait_seconds` | Histogram | Time from HITL creation to completion | `tenant_id` |
| `hitl_expired_total` | Counter | Tasks that expired without completion | `tenant_id` |
| `hitl_completed_total` | Counter | Successfully completed HITL tasks | `operator`, `tenant_id` |

#### Dashboard Panels

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       HITL OPERATIONS DASHBOARD                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ Pending Tasks  │  │ Avg Wait Time  │  │ Expired Today  │  │ Completed Today│ │
│  │                │  │                │  │                │  │                │ │
│  │    ┌───┐       │  │    ┌────┐      │  │    ┌───┐       │  │    ┌────┐      │ │
│  │    │ 5 │       │  │    │ 8m │      │  │    │ 2 │       │  │    │ 47 │      │ │
│  │    └───┘       │  │    └────┘      │  │    └───┘       │  │    └────┘      │ │
│  │   awaiting     │  │   to resolve   │  │   ⚠ warning    │  │   resolved     │ │
│  └────────────────┘  └────────────────┘  └────────────────┘  └────────────────┘ │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    HITL WAIT TIME (p95) - Time Series                      │  │
│  │                                                                            │  │
│  │   SLA Threshold ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ 15m             │  │
│  │                                                                            │  │
│  │   ════════════════════════════════════════════════════════════            │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    PENDING TASKS BY AGE - Stacked Bar                      │  │
│  │                                                                            │  │
│  │   ████████████ < 5 min                                                    │  │
│  │   ▓▓▓▓▓▓▓▓ 5-15 min                                                       │  │
│  │   ░░░░ > 15 min (approaching SLA)                                         │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    EXPIRATIONS OVER TIME - Counter                         │  │
│  │                                                                            │  │
│  │   Any expirations indicate SLA breach - alert immediately                 │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Alerts

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| **HITL Wait SLA** | `hitl_wait_seconds p95 > 15m` | Warning | Notify operators |
| **HITL Expiration** | `increase(hitl_expired_total[1h]) > 0` | Critical | Jobs failed due to no response |
| **HITL Backlog** | `hitl_pending_total > 20` | Warning | Scale operator capacity |

---

### 4. Error Rates Dashboard

**Purpose:** Monitor failure rates to detect system issues and target site problems.

#### Metrics

| Metric | Type | Description | Labels |
|--------|------|-------------|--------|
| `failed_retryable_total` | Counter | Jobs that failed but will retry | `reason`, `tenant_id` |
| `failed_terminal_total` | Counter | Jobs that exhausted retries (DLQ) | `reason`, `tenant_id` |
| `error_by_type_total` | Counter | All errors categorized | `error_type`, `component` |
| `success_total` | Counter | Successfully completed jobs | `tenant_id` |

#### Dashboard Panels

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         ERROR RATES DASHBOARD                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │  Success Rate  │  │ Retryable/hour │  │ Terminal/hour  │  │  DLQ Size      │ │
│  │                │  │                │  │                │  │                │ │
│  │   ┌─────┐      │  │    ┌───┐       │  │    ┌───┐       │  │    ┌───┐       │ │
│  │   │98.5%│      │  │    │ 12│       │  │    │ 1 │       │  │    │ 3 │       │ │
│  │   └─────┘      │  │    └───┘       │  │    └───┘       │  │    └───┘       │ │
│  │   last hour    │  │   transient    │  │   ⚠ needs fix  │  │   awaiting     │ │
│  └────────────────┘  └────────────────┘  └────────────────┘  └────────────────┘ │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    ERROR RATE BY TYPE - Time Series                        │  │
│  │                                                                            │  │
│  │   ════ Login failures                                                      │  │
│  │   ──── Network timeouts                                                   │  │
│  │   .... Form validation errors                                             │  │
│  │   ─ ─  Session expired                                                    │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    TERMINAL FAILURES - Table                               │  │
│  │                                                                            │  │
│  │   Time       | Job ID    | Tenant    | Reason                             │  │
│  │   ─────────────────────────────────────────────────────────────────       │  │
│  │   14:23:01   | job-123   | acme-co   | Max retries exceeded               │  │
│  │   13:45:22   | job-456   | globex    | HITL timeout                       │  │
│  │   12:12:55   | job-789   | acme-co   | Target site blocked                │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                    SUCCESS vs FAILURE RATIO - Pie/Donut                    │  │
│  │                                                                            │  │
│  │              ████████████████████                                         │  │
│  │            ██                    ██   ████ Success (98.5%)                │  │
│  │           █                        █  ░░░░ Retryable (1.2%)               │  │
│  │           █      SUCCESS           █  ▓▓▓▓ Terminal (0.3%)                │  │
│  │           █                        █                                       │  │
│  │            ██                    ██                                        │  │
│  │              ████████████████████                                         │  │
│  │                                                                            │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Alerts

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| **Terminal Failure Spike** | `increase(failed_terminal_total[1h]) > 5` | Critical | Investigate immediately |
| **High Retry Rate** | `rate(failed_retryable_total[5m]) > 1` | Warning | Check target site status |
| **Low Success Rate** | `success_rate < 95%` for 15 minutes | Warning | System health check |

---

## Alert Configuration

### Alert Severity Levels

| Severity | Response Time | Notification Channel | Escalation |
|----------|---------------|----------------------|------------|
| **Info** | None | Dashboard only | None |
| **Warning** | < 4 hours | Slack | Escalate to Critical after 4h |
| **Critical** | < 15 minutes | PagerDuty + Slack | Auto-escalate after 30m |

### Alert Routing Rules

```yaml
# Grafana alert routing example
route:
  receiver: 'slack-warnings'
  group_by: ['alertname', 'severity']
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty-critical'
      continue: true
    - match:
        severity: critical
      receiver: 'slack-critical'
    - match:
        severity: warning
      receiver: 'slack-warnings'

receivers:
  - name: 'pagerduty-critical'
    pagerduty_configs:
      - service_key: '<pagerduty-key>'
        severity: critical
  
  - name: 'slack-critical'
    slack_configs:
      - channel: '#alerts-critical'
        title: '🚨 {{ .CommonAnnotations.summary }}'
  
  - name: 'slack-warnings'
    slack_configs:
      - channel: '#alerts-warnings'
        title: '⚠️ {{ .CommonAnnotations.summary }}'
```

---

## Metric Reference

### Complete Metric List

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `queue_depth` | Gauge | status, priority, tenant_id | Jobs waiting in queue |
| `job_wait_seconds` | Histogram | tenant_id, priority | Time from enqueue to pickup |
| `retry_count` | Counter | tenant_id, reason | Total job retries |
| `active_runs` | Gauge | worker_id | Currently processing jobs |
| `run_duration_seconds` | Histogram | final_state, tenant_id | Job processing time |
| `heartbeat_lag_seconds` | Gauge | worker_id, job_id | Time since last heartbeat |
| `hitl_pending_total` | Gauge | tenant_id | HITL tasks awaiting operator |
| `hitl_wait_seconds` | Histogram | tenant_id | HITL resolution time |
| `hitl_expired_total` | Counter | tenant_id | HITL tasks that expired |
| `failed_retryable_total` | Counter | reason, tenant_id | Transient failures |
| `failed_terminal_total` | Counter | reason, tenant_id | Permanent failures (DLQ) |
| `success_total` | Counter | tenant_id | Completed jobs |

### Prometheus Recording Rules

```yaml
# Recording rules for common queries
groups:
  - name: visa_automation_rules
    rules:
      # Success rate calculation
      - record: job:success_rate:5m
        expr: |
          sum(rate(success_total[5m])) /
          (sum(rate(success_total[5m])) + sum(rate(failed_terminal_total[5m])))
      
      # Queue depth by tenant
      - record: queue:depth_by_tenant:current
        expr: sum by (tenant_id) (queue_depth)
      
      # Average run duration
      - record: worker:run_duration:avg_5m
        expr: |
          rate(run_duration_seconds_sum[5m]) /
          rate(run_duration_seconds_count[5m])
```

---

## Dashboard Examples

### Example Grafana Dashboard JSON

```json
{
  "title": "Queue Health",
  "panels": [
    {
      "title": "Current Queue Depth",
      "type": "stat",
      "targets": [
        {
          "expr": "sum(queue_depth)",
          "legendFormat": "Queue Depth"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "thresholds": {
            "steps": [
              { "color": "green", "value": null },
              { "color": "yellow", "value": 50 },
              { "color": "red", "value": 100 }
            ]
          }
        }
      }
    },
    {
      "title": "Job Wait Time (p95)",
      "type": "timeseries",
      "targets": [
        {
          "expr": "histogram_quantile(0.95, sum(rate(job_wait_seconds_bucket[5m])) by (le))",
          "legendFormat": "p95 wait time"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "custom": {
            "thresholdsStyle": {
              "mode": "line"
            }
          },
          "thresholds": {
            "steps": [
              { "color": "green", "value": null },
              { "color": "red", "value": 30 }
            ]
          }
        }
      }
    }
  ]
}
```

### PromQL Examples

```promql
# Queue depth trend
sum(queue_depth) by (status)

# Jobs waiting longer than SLA
sum(queue_depth{}) > 30

# Success rate over last hour
(sum(increase(success_total[1h]))) / 
(sum(increase(success_total[1h])) + sum(increase(failed_terminal_total[1h]))) * 100

# Retry rate per minute
sum(rate(retry_count[5m])) * 60

# Worker utilization
sum(active_runs) / sum(worker_ready) * 100

# HITL tasks approaching expiry (> 10 min old)
sum(hitl_pending_total) - sum(hitl_pending_total offset 10m)

# Error breakdown by type
sum by (reason) (rate(failed_retryable_total[5m]))
```


---

## Architecture Notes

### Agent / Portal Metrics [MVP REQUIRED]

Add visibility for portal-based execution:

Recommended metrics:
- agent_active_total{portal_id}
- portal_concurrency_limit{portal_id}
- portal_paused{portal_id}
- circuit_breaker_tripped_total{portal_id}

Purpose:
Detect bans, pauses, and overload early.

### Portal Canary Monitoring [MVP REQUIRED]

Track change-detection health:

- last_canary_success_timestamp
- canary_failures_total
- selector_mismatch_total
- portal_change_detected_total

Alert if:
- canary fails repeatedly
- change detected
- portal paused automatically

### Deployment Safety Check [OPS]

After each deployment:
- verify canary passes
- verify worker queue drains normally
- verify error rate stable

---
