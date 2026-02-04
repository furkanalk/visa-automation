## Scope Labels

This document is an **operational & financial planning reference**, not an execution requirement.

Sections are labeled:

- **[OPS]** → budgeting, cost modeling, capacity planning
- **[PHASED / LATER]** → setup or non-critical improvements
- **[MVP REQUIRED]** → only if strictly needed for initial deployment (rare here)

This file helps answer **“how much will it cost?”**, not **“what must be built now?”**

---

# Cost Estimation Guide

## Total Cost of Ownership (TCO) for Visa Automation System

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Architecture](../architecture/VISA_SAAS_ARCHITECTURE.md) | [CI/CD Pipeline](../operations/VISA_CICD_PIPELINE.md) | [Production Runbook](../operations/VISA_PRODUCTION_RUNBOOK.md)

---

## Table of Contents

1. [Cost Overview](#1-cost-overview)
2. [Monthly Operating Costs (OPEX)](#2-monthly-operating-costs-opex)
3. [Setup Costs (CAPEX)](#3-setup-costs-capex)
4. [Cost Scenarios](#4-cost-scenarios)
5. [Cost Calculator](#5-cost-calculator)
6. [Cost Optimization Tips](#6-cost-optimization-tips)

---

## 1. Cost Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         COST STRUCTURE OVERVIEW                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Total Cost = CAPEX (one-time setup) + OPEX (monthly operations)                 │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  CAPEX (Setup)                                                          │    │
│  │  ═══════════════════════════════════════════════════════════════════    │    │
│  │  • Development time (largest cost)                                      │    │
│  │  • Infrastructure setup                                                 │    │
│  │  • Security audits (optional)                                           │    │
│  │  • One-time: $0 (self) to $50,000+ (outsourced)                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  OPEX (Monthly)                                                         │    │
│  │  ═══════════════════════════════════════════════════════════════════    │    │
│  │  • Compute (EC2)              ~$110-560/mo                              │    │
│  │  • Storage (EBS + S3)         ~$20-100/mo                               │    │
│  │  • Proxy services             ~$100-5,000+/mo  ← LARGEST VARIABLE       │    │
│  │  • CAPTCHA solvers            ~$1-20/mo       (minor, latency matters)  │    │
│  │  • Observability              ~$0-100/mo                                │    │
│  │  • Email/SMS                  ~$5-50/mo                                 │    │
│  │  • Data transfer              ~$10-200/mo                               │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Total range: $250 - $6,000+ / month                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ╔═════════════════════════════════════════════════════════════════════════╗    │
│  ║  KEY INSIGHT: Proxy costs often exceed compute costs by 2-20x           ║    │
│  ╚═════════════════════════════════════════════════════════════════════════╝    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Monthly Operating Costs (OPEX)

### 2.1 Compute (AWS EC2)

| Instance Type | vCPU | RAM | Workers | On-Demand/mo | Reserved/mo (1yr) |
|---------------|------|-----|---------|--------------|-------------------|
| t3.large | 2 | 8 GB | 1 | ~$60 | ~$38 |
| t3a.xlarge | 4 | 16 GB | 2-3 | ~$110 | ~$70 |
| m6i.xlarge | 4 | 16 GB | 4-5 | ~$140 | ~$90 |
| m6i.2xlarge | 8 | 32 GB | 10-12 | ~$280 | ~$180 |
| m6i.4xlarge | 16 | 64 GB | 24-27 | ~$560 | ~$360 |

> **Note:** Reserved Instances (1-year commitment) save ~35-40% vs on-demand.

### 2.2 Storage

#### EBS (Block Storage for VM)

| Size | Type | IOPS | Monthly Cost |
|------|------|------|--------------|
| 100 GB | gp3 | 3,000 | ~$8 |
| 200 GB | gp3 | 3,000 | ~$16 |
| 500 GB | gp3 | 3,000 | ~$40 |
| 500 GB | gp3 | 6,000 | ~$50 |

#### S3 (Evidence Packs & Archives)

| Storage Tier | Cost/GB/mo | Use Case |
|--------------|------------|----------|
| S3 Standard | $0.023 | Active evidence packs |
| S3 Standard-IA | $0.0125 | 90+ day old packs |
| S3 Glacier | $0.004 | Archived (1+ year) |

**Evidence Pack Storage Estimate:**

| Monthly Jobs | Avg Pack Size | Monthly Storage | Monthly Cost |
|--------------|---------------|-----------------|--------------|
| 500 | 5 MB | 2.5 GB | ~$0.06 |
| 2,000 | 5 MB | 10 GB | ~$0.23 |
| 5,000 | 5 MB | 25 GB | ~$0.58 |
| 10,000 | 5 MB | 50 GB | ~$1.15 |

*Cumulative storage grows; lifecycle policies move old packs to cheaper tiers.*

### 2.3 Data Transfer (Egress)

AWS charges for data leaving the region:

| Tier | Cost/GB |
|------|---------|
| First 10 TB/mo | $0.09 |
| Next 40 TB/mo | $0.085 |
| Next 100 TB/mo | $0.07 |

**Estimate by Usage:**

| Scenario | Monthly Egress | Monthly Cost |
|----------|----------------|--------------|
| Light (portal + API) | 10 GB | ~$1 |
| Medium (+ evidence downloads) | 50 GB | ~$5 |
| Heavy (many downloads) | 200 GB | ~$18 |
| Very heavy | 1 TB | ~$90 |

### 2.4 Proxy Services (LARGEST VARIABLE)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PROXY COST BREAKDOWN                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Proxy costs depend on:                                                          │
│  • Type: Datacenter < Residential < Mobile                                       │
│  • Geography: US/EU cheap, rare countries expensive                              │
│  • Session type: Rotating vs Sticky                                              │
│  • Bandwidth consumption                                                         │
│  • Ban/retry rate (more bans = more proxy consumption)                           │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  PROXY TYPE COMPARISON                                                  │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │                                                                         │    │
│  │  Type          │ Cost/GB   │ Cost/Port/mo │ Detection Risk │ Use Case   │    │
│  │  ──────────────┼───────────┼──────────────┼────────────────┼────────────│    │
│  │  Datacenter    │ $0.5-2    │ $1-5         │ HIGH           │ Testing    │    │
│  │  Residential   │ $5-15     │ N/A          │ LOW            │ Production │    │
│  │  ISP (Static)  │ $2-5      │ $5-20        │ MEDIUM         │ Hybrid     │    │
│  │  Mobile        │ $20-50    │ N/A          │ VERY LOW       │ Hardened   │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  MONTHLY PROXY COST ESTIMATES:                                                   │
│                                                                                  │
│  │ Monthly Jobs │ Bandwidth │ Residential │ Mobile (hardened) │                  │
│  │──────────────│───────────│─────────────│───────────────────│                  │
│  │     500      │  ~25 GB   │   $125-375  │    $500-1,250     │                  │
│  │   2,000      │  ~100 GB  │   $500-1,500│   $2,000-5,000    │                  │
│  │   5,000      │  ~250 GB  │ $1,250-3,750│   $5,000-12,500   │                  │
│  │  10,000      │  ~500 GB  │ $2,500-7,500│  $10,000-25,000   │                  │
│                                                                                  │
│  Assumptions: ~50MB bandwidth per job (pages + uploads + screenshots)            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.5 Observability

| Option | Cost | Pros | Cons |
|--------|------|------|------|
| **Grafana Cloud Free** | $0 | 10k metrics, 50GB logs | Limited retention |
| **Grafana Cloud Pro** | ~$50-200/mo | More capacity | Pay per usage |
| **Self-hosted** | $0 (extra RAM) | Full control | Uses worker RAM |

**Recommendation:** Start with Grafana Cloud Free, upgrade as needed.

### 2.6 Email & SMS

#### Email (AWS SES)

| Volume | Cost |
|--------|------|
| First 62,000/mo (from EC2) | FREE |
| After | $0.10 per 1,000 |

**Typical usage:** 500-2,000 emails/month = ~$0-5

#### SMS (Twilio/SNS)

| Region | Cost/SMS |
|--------|----------|
| US | ~$0.0075 |
| EU | ~$0.04-0.08 |
| Turkey | ~$0.03-0.10 |

**Typical usage:** 100-500 SMS/month = ~$5-50

### 2.7 CAPTCHA Solver Services

Modern websites often employ CAPTCHA challenges that cannot be bypassed with stealth plugins alone. External solver services add cost but significantly improve success rates.

**Provider Pricing:**

| Provider | reCAPTCHA v2 | hCaptcha | GeeTest | Turnstile |
|----------|--------------|----------|---------|-----------|
| 2Captcha | $2.99/1000 | $2.99/1000 | $2.99/1000 | $2.99/1000 |
| CapMonster | $0.60/1000 | $1.00/1000 | $2.00/1000 | $1.00/1000 |
| CapSolver | $0.80/1000 | $0.80/1000 | $1.50/1000 | $0.80/1000 |

**Monthly Cost Estimates:**

| Monthly Jobs | CAPTCHA Rate | Est. CAPTCHAs | Cost (~$2/1000) |
|--------------|--------------|---------------|-----------------|
| 500 | 30% | 150 | ~$0.30 |
| 2,000 | 30% | 600 | ~$1.20 |
| 5,000 | 30% | 1,500 | ~$3.00 |
| 10,000 | 30% | 3,000 | ~$6.00 |
| 10,000 | 80%* | 8,000 | ~$16.00 |

*\*Some target sites have high CAPTCHA rates (80%+)*

**Key Insight:** CAPTCHA solver costs are typically minor ($1-20/mo) compared to proxy costs ($100-5,000+/mo). The real impact is **latency** (10-60 seconds per solve).

> **See also:** [CAPTCHA Solver Strategy](../business/VISA_CAPTCHA_SOLVER_STRATEGY.md) for implementation details.

### 2.8 Container Registry

| Registry | Cost |
|----------|------|
| **GitHub Container Registry** | FREE (with GitHub Actions) |
| AWS ECR | ~$0.10/GB/mo after 500MB free |
| Docker Hub | FREE (1 private repo, rate limits) |

**Recommendation:** GHCR (free, no setup)

### 2.9 Domain & SSL

| Item | Cost |
|------|------|
| Domain (.com) | ~$12-15/year |
| SSL (Let's Encrypt) | FREE |
| SSL (paid wildcard) | ~$50-200/year |

---

## 3. Setup Costs (CAPEX)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         DEVELOPMENT COST ESTIMATE                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Component                        │ Self-Dev (weeks) │ Outsourced ($)           │
│  ─────────────────────────────────┼──────────────────┼──────────────────────────│
│  Core Backend                     │                  │                          │
│  ├── Jobs/Queue/FSM               │     2-3          │     $5,000-10,000        │
│  ├── Tenants/Auth/RBAC            │     1-2          │     $3,000-6,000         │
│  ├── Billing/Evidence             │     1-2          │     $3,000-6,000         │
│  └── HITL System                  │     1-2          │     $3,000-6,000         │
│  ─────────────────────────────────┼──────────────────┼──────────────────────────│
│  Worker Framework                 │                  │                          │
│  ├── Playwright + Stealth         │     2-4          │     $5,000-12,000        │
│  ├── Proxy Management             │     1-2          │     $3,000-8,000         │
│  ├── First Target Adapter         │     2-4          │     $5,000-15,000        │
│  └── Additional Adapters (each)   │     1-3          │     $3,000-10,000        │
│  ─────────────────────────────────┼──────────────────┼──────────────────────────│
│  Portal UI                        │                  │                          │
│  ├── Auth + Dashboard             │     1-2          │     $3,000-6,000         │
│  ├── Job Management               │     1-2          │     $3,000-6,000         │
│  ├── HITL Interface               │     1            │     $2,000-4,000         │
│  └── Evidence/Billing Views       │     1            │     $2,000-4,000         │
│  ─────────────────────────────────┼──────────────────┼──────────────────────────│
│  DevOps                           │                  │                          │
│  ├── CI/CD Pipeline               │     0.5-1        │     $1,000-3,000         │
│  ├── Docker + Compose             │     0.5-1        │     $1,000-3,000         │
│  └── Monitoring + Alerts          │     0.5-1        │     $1,000-3,000         │
│  ─────────────────────────────────┼──────────────────┼──────────────────────────│
│  TOTAL (MVP)                      │    12-24 weeks   │    $40,000-100,000       │
│                                                                                  │
│  Note: "Self-Dev" assumes a senior full-stack developer.                         │
│  Opportunity cost: ~$50-100/hr × 40hrs/week × weeks                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Cost Scenarios

> **Scope:** [OPS]

### Scenario 1: MVP / Low Volume

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  SCENARIO: MVP / LOW VOLUME                                                      │
│  Target: 500 jobs/month, 2 concurrent workers                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Monthly OPEX:                                                                   │
│  ├── EC2 (t3a.xlarge)              $110                                         │
│  ├── EBS (100GB gp3)               $8                                           │
│  ├── S3 (evidence)                 $1                                           │
│  ├── Data Transfer                 $5                                           │
│  ├── Proxy (residential)           $150-400                                     │
│  ├── Observability (free tier)     $0                                           │
│  ├── Email (SES)                   $0                                           │
│  └── SMS (optional)                $10                                          │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  TOTAL:                            $285-535 / month                             │
│                                                                                  │
│  Cost per job:                     $0.57-1.07                                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Scenario 2: Production Standard

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  SCENARIO: PRODUCTION STANDARD                                                   │
│  Target: 2,000 jobs/month, 5 concurrent workers                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Monthly OPEX:                                                                   │
│  ├── EC2 (m6i.xlarge)              $140                                         │
│  ├── EBS (200GB gp3)               $16                                          │
│  ├── S3 (evidence + archive)       $5                                           │
│  ├── Data Transfer                 $20                                          │
│  ├── Proxy (residential)           $600-1,500                                   │
│  ├── Observability (Grafana Pro)   $50                                          │
│  ├── Email (SES)                   $2                                           │
│  └── SMS                           $25                                          │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  TOTAL:                            $860-1,760 / month                           │
│                                                                                  │
│  Cost per job:                     $0.43-0.88                                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Scenario 3: High Volume

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  SCENARIO: HIGH VOLUME                                                           │
│  Target: 10,000 jobs/month, 12 concurrent workers                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Monthly OPEX:                                                                   │
│  ├── EC2 (m6i.2xlarge)             $280                                         │
│  ├── EBS (500GB gp3)               $40                                          │
│  ├── S3 (evidence + archive)       $15                                          │
│  ├── Data Transfer                 $50                                          │
│  ├── Proxy (residential)           $3,000-7,500                                 │
│  ├── Observability (Grafana Pro)   $100                                         │
│  ├── Email (SES)                   $5                                           │
│  └── SMS                           $50                                          │
│  ─────────────────────────────────────────────────────────────────────────────  │
│  TOTAL:                            $3,540-8,040 / month                         │
│                                                                                  │
│  Cost per job:                     $0.35-0.80                                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Cost Calculator

> **Scope:** [OPS]

Use this template to estimate your monthly costs. Fill in your parameters:

### 5.1 Input Parameters

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         COST CALCULATOR INPUTS                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Parameter                        │ Your Value │ Unit        │ Notes            │
│  ─────────────────────────────────┼────────────┼─────────────┼──────────────────│
│  1. Target Concurrency            │ _____      │ workers     │ 1-27 range       │
│  2. Average Job Duration          │ _____      │ minutes     │ typical: 15-30   │
│  3. HITL Rate                     │ _____      │ %           │ typical: 5-20%   │
│  4. Evidence Pack Size            │ _____      │ MB          │ typical: 3-10 MB │
│  5. Monthly Download Count        │ _____      │ downloads   │ evidence pulls   │
│  6. Proxy Type                    │ _____      │ type        │ DC/Resi/Mobile   │
│  7. Target Geography              │ _____      │ country     │ affects proxy $  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Calculation Formulas

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CALCULATION FORMULAS                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  STEP 1: Monthly Job Capacity                                                    │
│  ───────────────────────────────────────────────────────────────────────────    │
│  jobs_per_hour = (60 / avg_job_duration) × concurrency                          │
│  jobs_per_month = jobs_per_hour × operating_hours × 30                          │
│                                                                                  │
│  Example: 5 workers × (60/20 min) × 8 hrs × 30 days = 3,600 jobs/month          │
│                                                                                  │
│  ───────────────────────────────────────────────────────────────────────────    │
│  STEP 2: Compute Cost                                                            │
│  ───────────────────────────────────────────────────────────────────────────    │
│  RAM needed = 6 GB (base) + (concurrency × 2 GB)                                │
│                                                                                  │
│  │ RAM Needed │ Instance     │ Monthly Cost │                                    │
│  │────────────│──────────────│──────────────│                                    │
│  │   8 GB     │ t3.large     │    $60       │                                    │
│  │  10-16 GB  │ m6i.xlarge   │    $140      │                                    │
│  │  18-32 GB  │ m6i.2xlarge  │    $280      │                                    │
│  │  34-64 GB  │ m6i.4xlarge  │    $560      │                                    │
│                                                                                  │
│  ───────────────────────────────────────────────────────────────────────────    │
│  STEP 3: Proxy Cost                                                              │
│  ───────────────────────────────────────────────────────────────────────────    │
│  bandwidth_per_job = 50 MB (typical)                                            │
│  monthly_bandwidth = jobs_per_month × bandwidth_per_job                         │
│  proxy_cost = monthly_bandwidth × rate_per_GB                                   │
│                                                                                  │
│  │ Proxy Type  │ Rate/GB │ 1000 jobs │ 5000 jobs │ 10000 jobs │                  │
│  │─────────────│─────────│───────────│───────────│────────────│                  │
│  │ Datacenter  │  $1     │    $50    │   $250    │    $500    │                  │
│  │ Residential │  $10    │   $500    │  $2,500   │   $5,000   │                  │
│  │ Mobile      │  $30    │  $1,500   │  $7,500   │  $15,000   │                  │
│                                                                                  │
│  ───────────────────────────────────────────────────────────────────────────    │
│  STEP 4: Storage Cost                                                            │
│  ───────────────────────────────────────────────────────────────────────────    │
│  new_storage = jobs_per_month × evidence_pack_size                              │
│  total_storage = cumulative (grows monthly, reduced by archival)                │
│  storage_cost = total_storage × $0.023/GB                                       │
│                                                                                  │
│  ───────────────────────────────────────────────────────────────────────────    │
│  STEP 5: Egress Cost                                                             │
│  ───────────────────────────────────────────────────────────────────────────    │
│  download_egress = monthly_downloads × evidence_pack_size                       │
│  egress_cost = download_egress × $0.09/GB                                       │
│                                                                                  │
│  ───────────────────────────────────────────────────────────────────────────    │
│  STEP 6: Notification Cost                                                       │
│  ───────────────────────────────────────────────────────────────────────────    │
│  emails = jobs_per_month × 3 (created, completed/failed, evidence ready)        │
│  sms = jobs_per_month × hitl_rate × 1.5                                         │
│  notification_cost = (emails × $0.0001) + (sms × $0.05)                         │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Quick Reference Tables

#### By Concurrency (5 workers, 20 min/job, residential proxy)

| Concurrency | Jobs/mo | Compute | Proxy | Storage | Total/mo |
|-------------|---------|---------|-------|---------|----------|
| 1 worker | 720 | $60 | $360 | $5 | ~$450 |
| 2 workers | 1,440 | $110 | $720 | $10 | ~$870 |
| 5 workers | 3,600 | $140 | $1,800 | $20 | ~$2,000 |
| 10 workers | 7,200 | $280 | $3,600 | $40 | ~$4,000 |
| 20 workers | 14,400 | $560 | $7,200 | $75 | ~$7,900 |

#### By Job Duration (5 workers, residential proxy)

| Duration | Jobs/mo | Proxy Bandwidth | Proxy Cost | Total/mo |
|----------|---------|-----------------|------------|----------|
| 10 min | 7,200 | 360 GB | $3,600 | ~$4,100 |
| 15 min | 4,800 | 240 GB | $2,400 | ~$2,800 |
| 20 min | 3,600 | 180 GB | $1,800 | ~$2,200 |
| 30 min | 2,400 | 120 GB | $1,200 | ~$1,600 |
| 45 min | 1,600 | 80 GB | $800 | ~$1,200 |

#### By Proxy Type (5 workers, 3,600 jobs/mo)

| Proxy Type | Rate/GB | Monthly Cost | Total System |
|------------|---------|--------------|--------------|
| Datacenter | $1 | $180 | ~$450 |
| ISP/Static | $3 | $540 | ~$800 |
| Residential | $10 | $1,800 | ~$2,100 |
| Mobile | $30 | $5,400 | ~$5,700 |

---

## 6. Cost Optimization Tips

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         COST OPTIMIZATION STRATEGIES                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. COMPUTE                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ✅ Use Reserved Instances (1-year): Save 35-40%                        │    │
│  │  ✅ Use Spot Instances for dev/test: Save 60-90%                        │    │
│  │  ✅ Right-size: Don't overprovision RAM                                 │    │
│  │  ✅ Schedule: Stop dev instances nights/weekends                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  2. PROXY (biggest lever)                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ✅ Start with residential, upgrade to mobile only if needed            │    │
│  │  ✅ Negotiate volume discounts with providers                           │    │
│  │  ✅ Reduce ban rate → fewer retries → less bandwidth                    │    │
│  │  ✅ Cache static resources locally (don't re-fetch via proxy)           │    │
│  │  ✅ Compress screenshots before upload                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  3. STORAGE                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ✅ Lifecycle policies: Move to S3-IA after 90 days                     │    │
│  │  ✅ Lifecycle policies: Move to Glacier after 1 year                    │    │
│  │  ✅ Delete non-essential artifacts after retention period               │    │
│  │  ✅ Compress evidence packs (ZIP already, but optimize images)          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  4. DATA TRANSFER                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ✅ Use CloudFront for evidence downloads (cheaper than direct S3)      │    │
│  │  ✅ Generate download links on-demand (don't pre-sign everything)       │    │
│  │  ✅ Compress API responses (gzip)                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  5. OBSERVABILITY                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ✅ Start with Grafana Cloud free tier                                  │    │
│  │  ✅ Reduce log verbosity in production (INFO, not DEBUG)                │    │
│  │  ✅ Sample traces (10%) instead of 100%                                 │    │
│  │  ✅ Aggregate metrics before shipping                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  6. GENERAL                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ✅ Monitor costs weekly (AWS Cost Explorer + alerts)                   │    │
│  │  ✅ Set billing alerts at 50%, 80%, 100% of budget                      │    │
│  │  ✅ Review and rightsize quarterly                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Cost Alert Thresholds

```yaml
# AWS Budget configuration example
Budgets:
  - Name: visa-automation-monthly
    Amount: 1000  # Your budget
    Alerts:
      - Threshold: 50
        NotificationType: ACTUAL
        Recipients: [ops@company.com]
      - Threshold: 80
        NotificationType: ACTUAL
        Recipients: [ops@company.com, finance@company.com]
      - Threshold: 100
        NotificationType: FORECASTED
        Recipients: [ops@company.com, cto@company.com]
```

---

## Summary

| Scenario | Monthly Jobs | Monthly Cost | Cost/Job |
|----------|--------------|--------------|----------|
| MVP/Pilot | 500 | $285-535 | $0.57-1.07 |
| Production Low | 2,000 | $860-1,760 | $0.43-0.88 |
| Production Standard | 5,000 | $1,800-4,000 | $0.36-0.80 |
| Production High | 10,000 | $3,500-8,000 | $0.35-0.80 |

**Key Takeaway:** Proxy costs dominate. Optimize proxy strategy first, compute second.


---

## Notes Related to Architecture

### Agent Concurrency Impact [OPS]
Total proxy/bandwidth usage scales roughly with:
`active_agents × requests_per_minute × page_weight`

Higher parallelism increases both success rate and cost. Use **portal policies (SERIAL/PARALLEL + max_concurrency)** to balance cost vs speed.

### Circuit Breaker Savings [OPS]
When portal bans or 429 spikes occur:
- system auto-pauses intake
- agents stop consuming proxies
- costs temporarily drop

This is intentional and protects both budget and IP reputation.

---
