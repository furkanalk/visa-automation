## Scope Labels

This document defines the **CAPTCHA solving strategy & anti-bot defenses**.

Sections are labeled:

- **[MVP REQUIRED]** → required for first production
- **[PHASED / LATER]** → improvements or scale optimizations
- **[OPS]** → operational or cost guidance

This is a **reference strategy doc**, not an execution checklist.

---

# CAPTCHA Solver Strategy

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Worker Lifecycle](../architecture/VISA_WORKER_LIFECYCLE.md) | [Cost Estimation](../business/VISA_COST_ESTIMATION.md) | [SaaS Architecture](../architecture/VISA_SAAS_ARCHITECTURE.md)

---

## Table of Contents

1. [Overview](#1-overview)
2. [CAPTCHA Types & Detection](#2-captcha-types--detection)
3. [Solver Architecture](#3-solver-architecture)
4. [Solver Adapter Pattern](#4-solver-adapter-pattern)
5. [Cost & Latency Impact](#5-cost--latency-impact)
6. [IP Warming Strategy](#6-ip-warming-strategy)
7. [Canary Jobs (DOM Monitoring)](#7-canary-jobs-dom-monitoring)
8. [Integration Checklist](#8-integration-checklist)

---

## 1. Overview


### Runtime Policy (Layered Fallback) [MVP REQUIRED]

Workers must follow strict order:

1. Stealth / fingerprint only
2. Automated solver (primary → secondary provider)
3. HITL escalation

Rules:
- Never jump directly to HITL if automated solver is available
- Max automated retries: 2–3
- If solver latency > threshold → escalate
- Record solver metrics for cost tracking

Purpose:
Minimize human intervention while keeping reliability near 100%.



> **Scope:** [MVP REQUIRED]
Modern Web Application Firewalls (WAFs) and bot protection systems cannot be bypassed with `puppeteer-extra-plugin-stealth` alone. This document defines the strategy for integrating external CAPTCHA solver services and managing the operational challenges they introduce.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      CAPTCHA RESOLUTION HIERARCHY                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 1: STEALTH (Passive)                                             │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • puppeteer-extra-plugin-stealth                                       │    │
│  │  • Human-like mouse movements / typing delays                           │    │
│  │  • Canvas/WebGL fingerprint randomization                               │    │
│  │  • TLS fingerprint matching (curl-impersonate)                          │    │
│  │                                                                         │    │
│  │  Success Rate: 60-80% (depends on target sophistication)               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                              │                                                  │
│                              ▼ CAPTCHA triggered                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 2: AUTOMATED SOLVER (External Service)                           │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • 2Captcha, CapMonster, CapSolver, Anti-Captcha                        │    │
│  │  • Latency: 10-60 seconds per solve                                     │    │
│  │  • Cost: $0.50-3.00 per 1000 solves                                     │    │
│  │                                                                         │    │
│  │  Success Rate: 90-98% (for supported CAPTCHA types)                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                              │                                                  │
│                              ▼ Solver failed / unsupported type                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  LAYER 3: HITL (Human-in-the-Loop)                                      │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Screenshot + context sent to operator                                │    │
│  │  • SLA: 5-15 minute response time                                       │    │
│  │  • Cost: Human operator time                                            │    │
│  │                                                                         │    │
│  │  Success Rate: ~100% (manual fallback)                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. CAPTCHA Types & Detection


> **Scope:** [MVP REQUIRED]
### 2.1 Common CAPTCHA Systems

| System | Difficulty | Auto-Solvable? | Notes |
|--------|------------|----------------|-------|
| **reCAPTCHA v2** | Medium | ✅ Yes | Image grid, checkbox |
| **reCAPTCHA v3** | Low-Medium | ✅ Yes (token) | Score-based, invisible |
| **hCaptcha** | Medium | ✅ Yes | Similar to reCAPTCHA v2 |
| **Cloudflare Turnstile** | Low-High | ⚠️ Partial | Often auto-pass with good fingerprint |
| **Datadome** | High | ⚠️ Partial | Behavioral analysis heavy |
| **GeeTest (Slide)** | Medium | ✅ Yes | Sliding puzzle |
| **GeeTest v4** | High | ⚠️ Partial | Multi-challenge |
| **FunCaptcha** | High | ⚠️ Partial | Rotation/matching puzzles |
| **Text CAPTCHA** | Low | ✅ Yes (OCR) | Legacy systems |

### 2.2 CAPTCHA Detection in Worker

```typescript
interface CaptchaDetection {
  detected: boolean;
  type: CaptchaType;
  siteKey?: string;      // For reCAPTCHA/hCaptcha
  pageUrl: string;
  challenge?: {
    imageData?: string;  // Base64 encoded
    instruction?: string;
  };
}

type CaptchaType = 
  | 'recaptcha_v2'
  | 'recaptcha_v3'
  | 'hcaptcha'
  | 'cloudflare_turnstile'
  | 'geetest'
  | 'datadome'
  | 'funcaptcha'
  | 'text_captcha'
  | 'unknown';

async function detectCaptcha(page: Page): Promise<CaptchaDetection> {
  // Check for common CAPTCHA iframes and elements
  const captchaSelectors = {
    recaptcha_v2: 'iframe[src*="recaptcha/api2"]',
    recaptcha_v3: 'script[src*="recaptcha/api.js?render="]',
    hcaptcha: 'iframe[src*="hcaptcha.com"]',
    cloudflare_turnstile: 'iframe[src*="challenges.cloudflare.com"]',
    geetest: '.geetest_holder, .geetest_captcha',
    datadome: 'iframe[src*="datadome.co"]',
  };
  
  for (const [type, selector] of Object.entries(captchaSelectors)) {
    const element = await page.$(selector);
    if (element) {
      return {
        detected: true,
        type: type as CaptchaType,
        pageUrl: page.url(),
        siteKey: await extractSiteKey(page, type as CaptchaType),
      };
    }
  }
  
  return { detected: false, type: 'unknown', pageUrl: page.url() };
}
```

---

## 3. Solver Architecture


> **Scope:** [MVP REQUIRED]
### 3.1 Solver Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CAPTCHA SOLVING FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Worker encounters CAPTCHA                                                       │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 1: DETECT & CLASSIFY                                              │    │
│  │  • Identify CAPTCHA type                                                │    │
│  │  • Extract site key (if applicable)                                     │    │
│  │  • Capture challenge image/data                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 2: SELECT SOLVER                                                  │    │
│  │  • Check solver capability matrix                                       │    │
│  │  • Primary: Automated solver (2Captcha, CapMonster)                     │    │
│  │  • Fallback: HITL                                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ├──────────────────────────────────────────┐                              │
│       ▼                                          ▼                              │
│  ┌──────────────────────┐               ┌──────────────────────┐               │
│  │ AUTOMATED SOLVER     │               │ HITL ESCALATION      │               │
│  │ • Send to service    │               │ • Create HITL task   │               │
│  │ • Wait 10-60 sec     │               │ • Transition job to  │               │
│  │ • Receive token      │               │   WAITING_HITL       │               │
│  └──────────┬───────────┘               └──────────────────────┘               │
│             │                                                                   │
│             ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 3: INJECT SOLUTION                                                │    │
│  │  • For token-based: Inject g-recaptcha-response                         │    │
│  │  • For click-based: Execute click sequence                              │    │
│  │  • For slide: Perform slide action                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Step 4: VERIFY & CONTINUE                                              │    │
│  │  • Verify CAPTCHA cleared                                               │    │
│  │  • If failed, retry (up to 3 times) or escalate to HITL                 │    │
│  │  • Resume normal job execution                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Solver Provider Comparison

| Provider | Pricing (per 1000) | Avg. Speed | Supported Types | API Quality |
|----------|-------------------|------------|-----------------|-------------|
| **2Captcha** | $0.50-3.00 | 15-45 sec | All major | ⭐⭐⭐⭐ |
| **CapMonster Cloud** | $0.60-2.50 | 10-30 sec | All major | ⭐⭐⭐⭐⭐ |
| **CapSolver** | $0.80-3.50 | 12-40 sec | All major | ⭐⭐⭐⭐ |
| **Anti-Captcha** | $0.70-3.00 | 15-50 sec | All major | ⭐⭐⭐⭐ |
| **Death By Captcha** | $1.39-2.89 | 20-60 sec | Limited | ⭐⭐⭐ |

**Recommendation:** Use **CapMonster Cloud** or **2Captcha** as primary, with the other as fallback.

---

## 4. Solver Adapter Pattern


> **Scope:** [MVP REQUIRED]
### 4.1 Interface Definition

```typescript
interface CaptchaSolverAdapter {
  name: string;
  supportedTypes: CaptchaType[];
  
  solve(request: SolveRequest): Promise<SolveResult>;
  getBalance(): Promise<number>;
  reportIncorrect(taskId: string): Promise<void>;
}

interface SolveRequest {
  type: CaptchaType;
  pageUrl: string;
  siteKey?: string;
  imageBase64?: string;
  proxyConfig?: ProxyConfig;
  timeout?: number; // ms
}

interface SolveResult {
  success: boolean;
  taskId: string;
  token?: string;           // For token-based CAPTCHAs
  solution?: unknown;       // For other types (click coords, slide distance)
  latencyMs: number;
  costCredits: number;
  error?: string;
}
```

### 4.2 Adapter Implementation Example

```typescript
class TwoCaptchaAdapter implements CaptchaSolverAdapter {
  name = '2captcha';
  supportedTypes: CaptchaType[] = [
    'recaptcha_v2', 'recaptcha_v3', 'hcaptcha', 
    'geetest', 'funcaptcha', 'text_captcha'
  ];
  
  private apiKey: string;
  private baseUrl = 'https://2captcha.com';
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  async solve(request: SolveRequest): Promise<SolveResult> {
    const startTime = Date.now();
    
    // 1. Submit task
    const taskId = await this.submitTask(request);
    
    // 2. Poll for result
    const result = await this.pollResult(taskId, request.timeout || 120000);
    
    return {
      success: true,
      taskId,
      token: result.token,
      latencyMs: Date.now() - startTime,
      costCredits: this.estimateCost(request.type),
    };
  }
  
  private async submitTask(request: SolveRequest): Promise<string> {
    let endpoint = '/in.php';
    const params: Record<string, string> = {
      key: this.apiKey,
      json: '1',
      pageurl: request.pageUrl,
    };
    
    switch (request.type) {
      case 'recaptcha_v2':
        params.method = 'userrecaptcha';
        params.googlekey = request.siteKey!;
        break;
      case 'recaptcha_v3':
        params.method = 'userrecaptcha';
        params.googlekey = request.siteKey!;
        params.version = 'v3';
        params.action = 'verify';
        params.min_score = '0.7';
        break;
      case 'hcaptcha':
        params.method = 'hcaptcha';
        params.sitekey = request.siteKey!;
        break;
      // ... other types
    }
    
    // Add proxy if provided
    if (request.proxyConfig) {
      params.proxy = `${request.proxyConfig.host}:${request.proxyConfig.port}`;
      params.proxytype = request.proxyConfig.type;
    }
    
    const response = await fetch(`${this.baseUrl}${endpoint}?${new URLSearchParams(params)}`);
    const data = await response.json();
    
    if (data.status !== 1) {
      throw new Error(`2Captcha submit failed: ${data.error_text}`);
    }
    
    return data.request; // Task ID
  }
  
  private async pollResult(taskId: string, timeout: number): Promise<{ token: string }> {
    const pollInterval = 5000; // 5 seconds
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      await sleep(pollInterval);
      
      const response = await fetch(
        `${this.baseUrl}/res.php?key=${this.apiKey}&action=get&id=${taskId}&json=1`
      );
      const data = await response.json();
      
      if (data.status === 1) {
        return { token: data.request };
      }
      
      if (data.request !== 'CAPCHA_NOT_READY') {
        throw new Error(`2Captcha solve failed: ${data.request}`);
      }
    }
    
    throw new Error('CAPTCHA solve timeout');
  }
  
  async getBalance(): Promise<number> {
    const response = await fetch(
      `${this.baseUrl}/res.php?key=${this.apiKey}&action=getbalance&json=1`
    );
    const data = await response.json();
    return parseFloat(data.request);
  }
  
  async reportIncorrect(taskId: string): Promise<void> {
    await fetch(
      `${this.baseUrl}/res.php?key=${this.apiKey}&action=reportbad&id=${taskId}`
    );
  }
  
  private estimateCost(type: CaptchaType): number {
    const costMap: Record<CaptchaType, number> = {
      recaptcha_v2: 0.00299,
      recaptcha_v3: 0.00299,
      hcaptcha: 0.00299,
      geetest: 0.00299,
      funcaptcha: 0.00299,
      text_captcha: 0.001,
      cloudflare_turnstile: 0.00299,
      datadome: 0.00299,
      unknown: 0.003,
    };
    return costMap[type] || 0.003;
  }
}
```

### 4.3 Solver Manager (Multi-Provider Failover)

```typescript
class CaptchaSolverManager {
  private adapters: CaptchaSolverAdapter[] = [];
  private metrics: SolverMetrics;
  
  constructor(adapters: CaptchaSolverAdapter[]) {
    this.adapters = adapters;
    this.metrics = new SolverMetrics();
  }
  
  async solve(request: SolveRequest): Promise<SolveResult> {
    const compatibleAdapters = this.adapters.filter(
      a => a.supportedTypes.includes(request.type)
    );
    
    if (compatibleAdapters.length === 0) {
      // No automated solver supports this type → Escalate to HITL
      throw new CaptchaUnsupportedError(request.type);
    }
    
    let lastError: Error | null = null;
    
    for (const adapter of compatibleAdapters) {
      try {
        const result = await adapter.solve(request);
        
        // Record success metrics
        this.metrics.recordSolve(adapter.name, request.type, result.latencyMs, true);
        
        return result;
      } catch (error) {
        lastError = error as Error;
        this.metrics.recordSolve(adapter.name, request.type, 0, false);
        
        // Try next adapter
        continue;
      }
    }
    
    // All adapters failed
    throw lastError || new Error('All CAPTCHA solvers failed');
  }
}
```

### 4.4 Worker Integration

```typescript
// In worker execution loop
async function handleCaptcha(page: Page, jobId: string): Promise<void> {
  const detection = await detectCaptcha(page);
  
  if (!detection.detected) {
    return; // No CAPTCHA, continue normally
  }
  
  // Emit event for observability
  await emitJobEvent(jobId, 'CAPTCHA_DETECTED', {
    type: detection.type,
    page_url: detection.pageUrl,
  });
  
  try {
    // Try automated solver first
    const result = await captchaSolverManager.solve({
      type: detection.type,
      pageUrl: detection.pageUrl,
      siteKey: detection.siteKey,
    });
    
    // Inject solution
    await injectCaptchaSolution(page, detection.type, result);
    
    // Emit success event
    await emitJobEvent(jobId, 'CAPTCHA_SOLVED', {
      type: detection.type,
      solver: 'automated',
      latency_ms: result.latencyMs,
    });
    
  } catch (error) {
    if (error instanceof CaptchaUnsupportedError) {
      // Escalate to HITL
      await escalateToHITL(jobId, page, detection);
    } else {
      // Solver failed after retries → Escalate to HITL
      await escalateToHITL(jobId, page, detection);
    }
  }
}
```

---

## 5. Cost & Latency Impact


> **Scope:** [OPS]
### 5.1 CAPTCHA Cost per Job

| CAPTCHA Rate | Solver Cost/1000 | Cost per Job |
|--------------|------------------|--------------|
| 10% (1 in 10) | $2.99 | $0.003 |
| 30% (1 in 3) | $2.99 | $0.009 |
| 50% (1 in 2) | $2.99 | $0.015 |
| 100% (every job) | $2.99 | $0.030 |

### 5.2 Monthly CAPTCHA Cost Estimates

| Monthly Jobs | CAPTCHA Rate | Est. CAPTCHAs | Monthly Cost |
|--------------|--------------|---------------|--------------|
| 500 | 30% | 150 | ~$0.45 |
| 2,000 | 30% | 600 | ~$1.80 |
| 5,000 | 30% | 1,500 | ~$4.50 |
| 10,000 | 30% | 3,000 | ~$9.00 |

> **Note:** CAPTCHA solver costs are minor compared to proxy costs, but **latency** is the real impact.

### 5.3 Latency Impact on Capacity

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                   CAPTCHA LATENCY IMPACT ON WORKER CAPACITY                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Scenario: 5 concurrent workers, 20-minute average job                           │
│                                                                                  │
│  WITHOUT CAPTCHA:                                                                │
│  ────────────────────────────────────────────────────────────────────────────   │
│  Jobs/hour = 5 workers × (60 min / 20 min) = 15 jobs/hour                        │
│  Jobs/day = 15 × 24 = 360 jobs/day                                               │
│  Jobs/month = 360 × 30 = 10,800 jobs/month                                       │
│                                                                                  │
│  WITH CAPTCHA (30% rate, 30-second average solve):                               │
│  ────────────────────────────────────────────────────────────────────────────   │
│  Added time per job = 0.30 × 30 sec = 9 seconds                                  │
│  New avg job time = 20 min + 0.15 min = 20.15 min                                │
│  Jobs/hour = 5 × (60 / 20.15) = 14.9 jobs/hour (~1% reduction)                   │
│                                                                                  │
│  WITH CAPTCHA (100% rate, 45-second average solve):                              │
│  ────────────────────────────────────────────────────────────────────────────   │
│  Added time per job = 45 seconds = 0.75 min                                      │
│  New avg job time = 20 min + 0.75 min = 20.75 min                                │
│  Jobs/hour = 5 × (60 / 20.75) = 14.5 jobs/hour (~3.5% reduction)                 │
│                                                                                  │
│  ╔═══════════════════════════════════════════════════════════════════════════╗  │
│  ║  INSIGHT: CAPTCHA latency impact is moderate (1-5% capacity loss).         ║  │
│  ║  The bigger risk is HITL escalation, which can add 5-15 MINUTES.           ║  │
│  ╚═══════════════════════════════════════════════════════════════════════════╝  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---



### Ban / Rate Limit Interaction [MVP REQUIRED]

If CAPTCHA frequency or 403/429 spikes:

- Trigger portal circuit breaker
- Auto-pause new jobs for that portal
- Notify admin
- Resume after cooldown

This integrates with Worker Lifecycle → Portal Policies.

## 6. IP Warming Strategy


> **Scope:** [PHASED / LATER]
### 6.1 The Problem

Fresh proxy IP pools can trigger aggressive bot detection. Target sites may flag:
- New IP ranges with no browsing history
- Sudden traffic spikes from previously quiet IPs
- Identical behavioral patterns across multiple IPs

### 6.2 Warming Protocol

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         IP WARMING SCHEDULE                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Week 1: OBSERVATION                                                             │
│  ──────────────────────────────────────────────────────────────────────────────  │
│  • Concurrency: 1 worker                                                        │
│  • Jobs/day: 5-10                                                               │
│  • Purpose: Establish baseline, detect initial blocks                           │
│  • Action: Monitor ban rate, CAPTCHA rate                                       │
│                                                                                  │
│  Week 2: GRADUAL INCREASE                                                        │
│  ──────────────────────────────────────────────────────────────────────────────  │
│  • Concurrency: 2 workers                                                       │
│  • Jobs/day: 20-40                                                              │
│  • Purpose: Test scalability                                                    │
│  • Action: If ban rate > 10%, pause and investigate                             │
│                                                                                  │
│  Week 3: SOFT PRODUCTION                                                         │
│  ──────────────────────────────────────────────────────────────────────────────  │
│  • Concurrency: 3-4 workers                                                     │
│  • Jobs/day: 50-100                                                             │
│  • Purpose: Approach production levels                                          │
│  • Action: Fine-tune delays, rotate proxy geo if needed                         │
│                                                                                  │
│  Week 4+: FULL PRODUCTION                                                        │
│  ──────────────────────────────────────────────────────────────────────────────  │
│  • Concurrency: Target level (e.g., 5-10 workers)                               │
│  • Jobs/day: Full capacity                                                      │
│  • Purpose: Normal operations                                                   │
│  • Action: Continuous monitoring, adaptive throttling                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Warming Configuration

```typescript
interface WarmingConfig {
  // Current phase
  phase: 'observation' | 'gradual' | 'soft_prod' | 'full_prod';
  
  // Concurrency limits per phase
  maxWorkers: {
    observation: 1,
    gradual: 2,
    soft_prod: 4,
    full_prod: number, // Configured max
  };
  
  // Job delays (extra delay between jobs)
  interJobDelayMs: {
    observation: 60000,  // 1 minute
    gradual: 30000,      // 30 seconds
    soft_prod: 10000,    // 10 seconds
    full_prod: 0,        // No extra delay
  };
  
  // Alert thresholds
  banRateThreshold: 0.10;      // 10% ban rate triggers alert
  captchaRateThreshold: 0.50;  // 50% CAPTCHA rate triggers alert
  
  // Automatic phase progression
  autoProgress: boolean;
  progressCriteria: {
    minJobsCompleted: 50,
    maxBanRate: 0.05,
    minSuccessRate: 0.90,
  };
}
```

### 6.4 Adaptive Throttling

```typescript
class AdaptiveThrottler {
  private recentResults: JobResult[] = [];
  private readonly windowSize = 20; // Last 20 jobs
  
  async shouldThrottle(): Promise<{ throttle: boolean; delayMs: number }> {
    const stats = this.calculateStats();
    
    // High ban rate → Aggressive throttle
    if (stats.banRate > 0.15) {
      return { throttle: true, delayMs: 300000 }; // 5 minutes
    }
    
    // Moderate ban rate → Light throttle
    if (stats.banRate > 0.05) {
      return { throttle: true, delayMs: 60000 }; // 1 minute
    }
    
    // High CAPTCHA rate → Consider slowing down
    if (stats.captchaRate > 0.50) {
      return { throttle: true, delayMs: 30000 }; // 30 seconds
    }
    
    return { throttle: false, delayMs: 0 };
  }
  
  private calculateStats() {
    const recent = this.recentResults.slice(-this.windowSize);
    return {
      banRate: recent.filter(r => r.banned).length / recent.length,
      captchaRate: recent.filter(r => r.captchaEncountered).length / recent.length,
      successRate: recent.filter(r => r.success).length / recent.length,
    };
  }
}
```

---

## 7. Canary Jobs (DOM Monitoring)


> **Scope:** [MVP REQUIRED]
### 7.1 The Silent DOM Change Problem

Target sites frequently change their HTML structure without notice:
- Class names change: `.submit-btn` → `.submit-button-v2`
- IDs removed or renamed
- Form field names change
- New validation added

Workers may fail silently, submitting empty forms or timing out on non-existent elements.

### 7.2 Canary Job Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CANARY JOB SYSTEM                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  CANARY JOB DEFINITION                                                  │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Runs on schedule (e.g., every 6 hours)                               │    │
│  │  • Uses real credentials (test account)                                 │    │
│  │  • Navigates through ALL critical paths                                 │    │
│  │  • Does NOT submit final form (stops at last step)                      │    │
│  │  • Captures DOM fingerprints at each step                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                              │                                                  │
│                              ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  DOM FINGERPRINT COMPARISON                                             │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  For each critical selector:                                            │    │
│  │  • Does it exist?                                                       │    │
│  │  • Is it visible?                                                       │    │
│  │  • What are its attributes?                                             │    │
│  │  • What is its parent structure?                                        │    │
│  │                                                                         │    │
│  │  Compare against "known good" baseline                                  │    │
│  │  If drift > threshold → ALERT                                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                              │                                                  │
│                              ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ALERT & INCIDENT RESPONSE                                              │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Minor drift (class name change):                                       │    │
│  │  • Log warning                                                          │    │
│  │  • Update selector mapping                                              │    │
│  │                                                                         │    │
│  │  Major drift (element missing, flow broken):                            │    │
│  │  • Alert on-call                                                        │    │
│  │  • Consider PAUSE_ALL                                                   │    │
│  │  • Investigate and update adapter                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Canary Job Implementation

```typescript
interface CanaryCheckpoint {
  name: string;
  url: string | RegExp;
  requiredSelectors: string[];
  optionalSelectors: string[];
  expectedText?: Record<string, string | RegExp>;
}

interface CanaryResult {
  checkpoint: string;
  passed: boolean;
  missingSelectors: string[];
  unexpectedChanges: string[];
  screenshot: string; // Base64
  timestamp: Date;
}

async function runCanaryJob(
  targetSite: string,
  checkpoints: CanaryCheckpoint[]
): Promise<CanaryResult[]> {
  const results: CanaryResult[] = [];
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();
  
  for (const checkpoint of checkpoints) {
    const result = await checkCheckpoint(page, checkpoint);
    results.push(result);
    
    if (!result.passed) {
      // Stop at first failure for investigation
      break;
    }
  }
  
  await browser.close();
  return results;
}

async function checkCheckpoint(
  page: Page,
  checkpoint: CanaryCheckpoint
): Promise<CanaryResult> {
  const missingSelectors: string[] = [];
  const unexpectedChanges: string[] = [];
  
  // Check required selectors
  for (const selector of checkpoint.requiredSelectors) {
    const element = await page.$(selector);
    if (!element) {
      missingSelectors.push(selector);
    } else {
      // Check visibility
      const isVisible = await element.isVisible();
      if (!isVisible) {
        unexpectedChanges.push(`${selector} exists but not visible`);
      }
    }
  }
  
  // Check expected text
  if (checkpoint.expectedText) {
    for (const [selector, expectedPattern] of Object.entries(checkpoint.expectedText)) {
      const text = await page.textContent(selector);
      if (!text || !text.match(expectedPattern)) {
        unexpectedChanges.push(`${selector} text mismatch: "${text}"`);
      }
    }
  }
  
  return {
    checkpoint: checkpoint.name,
    passed: missingSelectors.length === 0 && unexpectedChanges.length === 0,
    missingSelectors,
    unexpectedChanges,
    screenshot: await page.screenshot({ encoding: 'base64' }),
    timestamp: new Date(),
  };
}
```

### 7.4 Canary Job Schedule

```yaml
# Cron configuration for canary jobs
canary_jobs:
  - name: "visa_site_health"
    schedule: "0 */6 * * *"  # Every 6 hours
    target: "visa_consulate_tr"
    checkpoints:
      - login_page
      - dashboard
      - new_application_form
      - appointment_calendar
    alert_channels:
      - slack: "#ops-alerts"
      - pagerduty: "visa-oncall"
    
  - name: "visa_site_critical"
    schedule: "0 */2 * * *"  # Every 2 hours during business hours
    target: "visa_consulate_tr"
    checkpoints:
      - login_page
      - appointment_calendar
    priority: high
```

---

## 8. Integration Checklist


> **Scope:** [MVP REQUIRED]
### Phase 1: CAPTCHA Solver Integration

- [ ] **Solver Accounts**
  - [ ] Create account with primary solver (e.g., 2Captcha)
  - [ ] Create account with backup solver (e.g., CapMonster)
  - [ ] Set up balance alerts at $10, $5, $1

- [ ] **Code Integration**
  - [ ] Implement `CaptchaSolverAdapter` interface
  - [ ] Implement primary solver adapter
  - [ ] Implement backup solver adapter
  - [ ] Implement `CaptchaSolverManager` with failover

- [ ] **Worker Integration**
  - [ ] Add CAPTCHA detection in worker loop
  - [ ] Add automated solve attempt before HITL
  - [ ] Add CAPTCHA events to `job_events`
  - [ ] Add solver metrics to Prometheus

### Phase 2: IP Warming

- [ ] **Configuration**
  - [ ] Define warming phases in config
  - [ ] Set initial phase to `observation`
  - [ ] Configure phase progression rules

- [ ] **Monitoring**
  - [ ] Add ban rate metric
  - [ ] Add CAPTCHA rate metric
  - [ ] Create warming progress dashboard
  - [ ] Set up alerts for threshold breaches

### Phase 3: Canary Jobs

- [ ] **Canary Definition**
  - [ ] Define checkpoints for each target site
  - [ ] Create baseline DOM fingerprints
  - [ ] Configure canary schedule

- [ ] **Alerting**
  - [ ] Set up canary failure alerts
  - [ ] Create incident response playbook for DOM changes
  - [ ] Document adapter update procedure

---

## Related Documents

- [Worker Lifecycle](../architecture/VISA_WORKER_LIFECYCLE.md) — Worker execution loop
- [Cost Estimation](../business/VISA_COST_ESTIMATION.md) — Total cost breakdown
- [Production Runbook](../operations/VISA_PRODUCTION_RUNBOOK.md) — Incident response
- [SaaS Architecture](../architecture/VISA_SAAS_ARCHITECTURE.md) — System overview
