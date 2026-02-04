# Customer Portal & Notifications Guide

## Employer Visibility, Minimal Load, and Operational Safety

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md) | [Database Schema](../database/VISA_DATABASE_SCHEMA.md) | [Grafana Dashboards](../operations/VISA_GRAFANA_DASHBOARDS.md) | [API Contract](../api/VISA_CORE_API_CONTRACT.md) | [Security Model](../security/VISA_SECURITY_MODEL.md)

---

## Scope Labels

This document includes both MVP and future portal capabilities. To avoid roadmap drift, sections are labeled:

- **[MVP REQUIRED]**: Needed for the first pilot (internal ops + basic customer visibility).
- **[PHASED / LATER]**: Keep as design reference for future phases (customer portal, billing, evidence sealing, etc.).
- **[OPTIONAL]**: Implement only if/when needed.

---

## Table of Contents

1. [Goal](#1-goal)
2. [System Boundary: UI vs Worker](#2-system-boundary-ui-vs-worker)
3. [User Journeys](#3-user-journeys)
   - [Operator Journey](#31-operator-journey)
   - [Employer (Customer) Journey](#32-employer-customer-journey)
   - [Admin Journey](#33-admin-journey)
   - [HITL Resolution Journey](#34-hitl-resolution-journey)
4. [Do We Need a Web UI?](#4-do-we-need-a-web-ui)
5. [Read-Optimized Portal Model](#5-read-optimized-portal-model)
6. [UI Update Strategy](#6-ui-update-strategy)
7. [Notifications](#7-notifications)
8. [Security & Privacy](#8-security--privacy)
9. [Minimum Employer View](#9-minimum-employer-view)
10. [Database Schema Additions](#10-database-schema-additions)
11. [API Endpoints](#11-api-endpoints)
12. [Implementation Checklist](#12-implementation-checklist)
13. [UI Development Guide](#13-ui-development-guide)
    - [Technology Stack](#131-technology-stack--architecture)
    - [Authentication Flow](#132-authentication-flow)
    - [Screen/Role Matrix](#133-screenrole-matrix)
    - [Data Refresh Strategy](#134-ui-data-refresh-strategy)
    - [Error States & UX](#135-error-states--ux-patterns)
    - [Component Library](#136-ui-component-library-standards)
    - [Accessibility](#137-accessibility-requirements)

---

## 1. Goal

> **Scope:** [MVP REQUIRED]

Provide employer/customer visibility into their visa application processing without overloading the single-server deployment.

### Core Requirements

| Requirement | Description |
|-------------|-------------|
| **Status Tracking** | Real-time visibility into job progress through FSM states |
| **Billing Proof** | Sealed evidence packs for completed jobs (audit trail) |
| **HITL Awareness** | Notification when human intervention is required |
| **Minimal Load** | Read-optimized queries that don't impact worker performance |

### Visibility Model

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          CUSTOMER VISIBILITY MODEL                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  PORTAL (Continuous Visibility)                                         │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • Customer pulls data when they want                                   │    │
│  │  • Read-optimized endpoints                                             │    │
│  │  • Pagination + caching                                                 │    │
│  │  • Optional SSE for real-time updates                                   │    │
│  │                                                                         │    │
│  │  Use Case: "Let me check the status of my applications"                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  NOTIFICATIONS (Event-Driven Visibility)                                │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  • System pushes updates to customer                                    │    │
│  │  • Triggered by significant state changes                               │    │
│  │  • Email, Webhook, SMS channels                                         │    │
│  │                                                                         │    │
│  │  Use Case: "Alert me when something needs attention"                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  PRINCIPLE:                                                                      │
│  • Portal = pull model (customer-initiated)                                      │
│  • Notifications = push model (system-initiated)                                 │
│  • Both work together for complete visibility                                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. System Boundary: UI vs Worker

> **Scope:** [MVP REQUIRED]

Understanding the separation between the **Portal UI** and the **Worker** is critical for system design and user expectations.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    SYSTEM BOUNDARY: UI vs WORKER                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  PORTAL UI = "CONTROL PANEL"                                            │    │
│  │  ═══════════════════════════════════════════════════════════════════    │    │
│  │                                                                         │    │
│  │  What users DO in the Portal:                                           │    │
│  │  • Create visa application records (our system's form, not consulate)   │    │
│  │  • Upload required documents (passport scans, photos, etc.)             │    │
│  │  • Submit jobs to the processing queue                                  │    │
│  │  • Monitor job status through FSM timeline                              │    │
│  │  • Respond to HITL requests (OTP, CAPTCHA, document clarification)      │    │
│  │  • Download evidence packs (billing proof)                              │    │
│  │  • View reports and billing history                                     │    │
│  │                                                                         │    │
│  │  The Portal is where users MANAGE the visa application process.         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  WORKER = "OPERATION ENGINE"                                            │    │
│  │  ═══════════════════════════════════════════════════════════════════    │    │
│  │                                                                         │    │
│  │  What the Worker DOES (headless browser automation):                    │    │
│  │  • Logs into consulate/visa portal websites                             │    │
│  │  • Fills out official application forms                                 │    │
│  │  • Uploads documents to target systems                                  │    │
│  │  • Books appointments                                                   │    │
│  │  • Handles site-specific workflows                                      │    │
│  │  • Captures screenshots for evidence                                    │    │
│  │  • Requests HITL when blocked (CAPTCHA, OTP)                            │    │
│  │                                                                         │    │
│  │  The Worker is where the actual visa application HAPPENS.               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ╔═════════════════════════════════════════════════════════════════════════╗    │
│  ║  KEY DISTINCTION:                                                       ║    │
│  ║                                                                         ║    │
│  ║  • Users fill out OUR form (Portal) → creates a Job                     ║    │
│  ║  • Worker fills out CONSULATE form (headless) → completes the Job       ║    │
│  ║                                                                         ║    │
│  ║  Users NEVER directly interact with consulate websites.                 ║    │
│  ╚═════════════════════════════════════════════════════════════════════════╝    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Why This Separation Matters

| Concern | UI Responsibility | Worker Responsibility |
|---------|-------------------|----------------------|
| **Data Collection** | Gather applicant info, documents | Use that data on target sites |
| **User Interaction** | Real-time, synchronous | Async, background processing |
| **Error Handling** | Form validation, UX feedback | Site errors, retries, HITL requests |
| **Security** | User auth, RBAC, tenant isolation | Proxy binding, stealth, site auth |
| **Scaling** | Stateless, easy to scale | Browser-bound, RAM-limited |

---

## 3. User Journeys

> **Scope:** [MVP REQUIRED]

### 3.1 Operator Journey

The **Operator** is the primary persona in B2B logistics scenarios. Operators manage the "application pool" for their organization.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         OPERATOR JOURNEY                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PERSONA: Operations staff at logistics company                                  │
│  GOAL: Process visa applications for drivers/employees efficiently               │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 1: BATCH JOB CREATION                                             │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Operator logs into Portal with `operator` role                         │    │
│  │                                                                         │    │
│  │  Actions:                                                               │    │
│  │  • Navigate to "New Application"                                        │    │
│  │  • Enter applicant details (driver name, passport, etc.)                │    │
│  │  • Upload documents (passport scan, photo, invitation letter)           │    │
│  │  • Select visa type and destination country                             │    │
│  │  • Set priority (VIP drivers get higher priority)                       │    │
│  │  • Submit → Job enters QUEUED state                                     │    │
│  │                                                                         │    │
│  │  Repeat for multiple applicants (batch entry supported)                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 2: QUEUE MONITORING                                               │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Operator monitors the application pool                                 │    │
│  │                                                                         │    │
│  │  Dashboard shows:                                                       │    │
│  │  • Jobs by status (QUEUED: 12, IN_PROGRESS: 4, COMPLETED: 45)           │    │
│  │  • Priority distribution                                                │    │
│  │  • Estimated completion times                                           │    │
│  │  • Any HITL tasks requiring attention                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 3: HITL RESOLUTION (when needed)                                  │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  System blocks on CAPTCHA or OTP → Operator is notified                 │    │
│  │                                                                         │    │
│  │  Operator:                                                              │    │
│  │  • Receives notification (email/in-app/SMS)                             │    │
│  │  • Opens HITL task in Portal                                            │    │
│  │  • Views screenshot of blocked screen                                   │    │
│  │  • Solves CAPTCHA or enters OTP (obtained from applicant)               │    │
│  │  • Submits resolution → Worker continues                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 4: COMPLETION & EVIDENCE                                          │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Job reaches COMPLETED state                                            │    │
│  │                                                                         │    │
│  │  Operator:                                                              │    │
│  │  • Views confirmation details (appointment date, reference number)      │    │
│  │  • Downloads evidence pack (screenshot, timeline, confirmation)         │    │
│  │  • Archives for records                                                 │    │
│  │  • Moves to next applicant                                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  KEY METRICS FOR OPERATORS:                                                      │
│  • Average processing time per application                                       │
│  • HITL response time (SLA tracking)                                             │
│  • Success rate by visa type                                                     │
│  • Priority queue wait times                                                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Employer (Customer) Journey

The **Employer** (customer account holder) has a more read-focused experience, primarily monitoring and reporting.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       EMPLOYER (CUSTOMER) JOURNEY                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PERSONA: Account manager or finance contact at customer company                 │
│  GOAL: Oversight, billing verification, high-level status awareness             │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 1: DASHBOARD OVERVIEW                                             │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Employer logs in with `viewer` role (read-mostly)                      │    │
│  │                                                                         │    │
│  │  Views:                                                                 │    │
│  │  • Summary statistics (this month's applications)                       │    │
│  │  • Success rate trends                                                  │    │
│  │  • Billing summary (completed jobs, pending charges)                    │    │
│  │  • Active applications (high-level status only)                         │    │
│  │                                                                         │    │
│  │  Note: PII is masked for privacy (see Data Protection policy)           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 2: BILLING VERIFICATION                                           │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Employer verifies charges against completed work                       │    │
│  │                                                                         │    │
│  │  Actions:                                                               │    │
│  │  • View invoice breakdown                                               │    │
│  │  • Download evidence packs for specific jobs                            │    │
│  │  • Verify confirmation numbers against billed items                     │    │
│  │  • Flag disputed charges (if any)                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 3: REPORT GENERATION                                              │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Employer generates reports for internal use                            │    │
│  │                                                                         │    │
│  │  Available reports:                                                     │    │
│  │  • Monthly processing summary                                           │    │
│  │  • Cost per visa type                                                   │    │
│  │  • SLA compliance (processing times)                                    │    │
│  │  • Export to CSV/PDF                                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  WHAT EMPLOYERS TYPICALLY DON'T DO:                                              │
│  • Create individual job records (delegated to Operators)                        │
│  • Resolve HITL tasks (delegated to Operators)                                   │
│  • Manage system settings (Admin only)                                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Admin Journey

#### Agent Fleet & Portal Policies (Admin)

Admins control **how many agents run per portal** and which portals each agent is allowed to process.

Portal policy (per portal):
- **Mode:** `SERIAL` (only 1 active agent at a time) or `PARALLEL` (up to N concurrent agents)
- **Max concurrency:** upper bound for parallel mode
- (optional) request budgets (rpm/rph) and circuit breaker thresholds

Agent assignment:
- Each agent can be assigned to one or more portal IDs (e.g., `idata-ita`, `as-visa-ankara`)
- Agents only pull jobs matching assigned portals

**Why this exists:** to reduce bans/rate-limit risk and to operationally control load by portal.

The **Admin** manages the tenant account, users, integrations, and system configuration.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            ADMIN JOURNEY                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PERSONA: IT administrator or account owner at customer company                  │
│  GOAL: Account setup, user management, integration configuration                 │
│                                                                                  │
│  ONBOARDING JOURNEY:                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. INITIAL SETUP                                                       │    │
│  │     • Receive account credentials                                       │    │
│  │     • Configure company profile                                         │    │
│  │     • Set up billing information                                        │    │
│  │                                                                         │    │
│  │  2. USER MANAGEMENT                                                     │    │
│  │     • Invite operators (assign `operator` role)                         │    │
│  │     • Invite finance contact (assign `viewer` role)                     │    │
│  │     • Set up SSO (if enterprise)                                        │    │
│  │                                                                         │    │
│  │  3. INTEGRATION SETUP                                                   │    │
│  │     • Generate API keys for backend integration                         │    │
│  │     • Configure webhook endpoints                                       │    │
│  │     • Test webhook delivery                                             │    │
│  │                                                                         │    │
│  │  4. NOTIFICATION PREFERENCES                                            │    │
│  │     • Configure notification channels (email, SMS, webhook)             │    │
│  │     • Set escalation rules                                              │    │
│  │     • Define HITL SLA thresholds                                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ONGOING MANAGEMENT:                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Review audit logs                                                    │    │
│  │  • Rotate API keys                                                      │    │
│  │  • Manage user access (add/remove/modify roles)                         │    │
│  │  • Handle billing disputes                                              │    │
│  │  • Contact support for escalated issues                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ADMIN-ONLY SCREENS:                                                             │
│  • /settings/users - User management                                             │
│  • /settings/api-keys - API key management                                       │
│  • /settings/webhooks - Webhook configuration                                    │
│  • /settings/audit - Audit log viewer                                            │
│  • /settings/billing - Billing settings & payment methods                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 HITL Resolution Journey

The **HITL (Human-in-the-Loop) Journey** is a critical path that any role with `hitl:resolve` permission may encounter.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        HITL RESOLUTION JOURNEY                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  TRIGGER: Worker encounters a block that requires human input                    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  HITL TRIGGER TYPES                                                     │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  • CAPTCHA: Image/text CAPTCHA on target site                           │    │
│  │  • OTP: One-time password sent to applicant's phone/email               │    │
│  │  • DOCUMENT_CLARIFICATION: Ambiguous document needs human review        │    │
│  │  • MANUAL_VERIFICATION: Site requires human confirmation step           │    │
│  │  • CUSTOM_INPUT: Site asks unexpected question                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  TIMELINE:                                                                       │
│                                                                                  │
│  T+0s    Worker detects block                                                    │
│    │     ┌─────────────────────────────────────────────────────────────────┐    │
│    │     │  Worker:                                                        │    │
│    │     │  • Captures screenshot                                          │    │
│    │     │  • Saves HTML snapshot                                          │    │
│    │     │  • Creates HITL task                                            │    │
│    │     │  • Transitions job to WAITING_HITL                              │    │
│    │     │  • Emits HITL_REQUESTED event                                   │    │
│    │     └─────────────────────────────────────────────────────────────────┘    │
│    │                                                                             │
│    ▼                                                                             │
│  T+5s    Notification sent                                                       │
│    │     ┌─────────────────────────────────────────────────────────────────┐    │
│    │     │  Notification system:                                           │    │
│    │     │  • Email to operator (with deep link)                           │    │
│    │     │  • Webhook to customer system (if configured)                   │    │
│    │     │  • In-app notification (if user online)                         │    │
│    │     │  • SMS for high-priority tasks (if configured)                  │    │
│    │     └─────────────────────────────────────────────────────────────────┘    │
│    │                                                                             │
│    ▼                                                                             │
│  T+2min  Operator sees notification                                              │
│    │     ┌─────────────────────────────────────────────────────────────────┐    │
│    │     │  Operator:                                                      │    │
│    │     │  • Clicks notification link                                     │    │
│    │     │  • Portal opens HITL task detail page                           │    │
│    │     │  • Views screenshot of blocked screen                           │    │
│    │     │  • Sees countdown timer (SLA: 30 minutes)                       │    │
│    │     └─────────────────────────────────────────────────────────────────┘    │
│    │                                                                             │
│    ▼                                                                             │
│  T+3min  Resolution                                                              │
│    │     ┌─────────────────────────────────────────────────────────────────┐    │
│    │     │  CAPTCHA Example:                                               │    │
│    │     │  • Operator views CAPTCHA image                                 │    │
│    │     │  • Types solution: "ABC123"                                     │    │
│    │     │  • Clicks "Submit Resolution"                                   │    │
│    │     │                                                                 │    │
│    │     │  OTP Example:                                                   │    │
│    │     │  • Operator contacts applicant (phone/chat)                     │    │
│    │     │  • Applicant provides OTP from their phone                      │    │
│    │     │  • Operator enters OTP: "847291"                                │    │
│    │     │  • Clicks "Submit Resolution"                                   │    │
│    │     └─────────────────────────────────────────────────────────────────┘    │
│    │                                                                             │
│    ▼                                                                             │
│  T+3min  Worker resumes                                                          │
│          ┌─────────────────────────────────────────────────────────────────┐    │
│          │  System:                                                        │    │
│          │  • HITL task marked RESOLVED                                    │    │
│          │  • Job transitions from WAITING_HITL back to processing         │    │
│          │  • Worker receives resolution data                              │    │
│          │  • Worker enters CAPTCHA/OTP on target site                     │    │
│          │  • Processing continues                                         │    │
│          └─────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  FAILURE SCENARIO (SLA EXPIRED):                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  If no resolution within SLA (default: 30 minutes):                     │    │
│  │  • HITL task marked EXPIRED                                             │    │
│  │  • Job transitions to FAILED_RETRYABLE                                  │    │
│  │  • Notification: "HITL task expired - job will retry"                   │    │
│  │  • Job re-queued (if retry budget allows)                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  BEST PRACTICES FOR OPERATORS:                                                   │
│  • Enable mobile notifications for HITL alerts                                   │
│  • Keep applicant contact info handy for OTP scenarios                           │
│  • Resolve within 5-10 minutes (target site sessions may timeout)                │
│  • Escalate immediately if unable to resolve                                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Journey Summary Matrix

| Journey | Primary Role | Key Actions | Success Metric |
|---------|--------------|-------------|----------------|
| **Operator** | `operator` | Create jobs, resolve HITL, monitor queue | Jobs completed per day |
| **Employer** | `viewer` | View reports, verify billing, download evidence (**strictly read-only**) | Billing accuracy |
| **Admin** | `admin` | Manage users, configure integrations | Team productivity |
| **HITL** | `operator`/`admin` | Resolve blocks quickly | HITL resolution time < 10 min |

---

## 4. Do We Need a Web UI?

> **Scope:** [MVP REQUIRED]

**Yes (recommended)** for B2B credibility and dispute reduction.

### Why a Portal is Recommended

| Benefit | Description |
|---------|-------------|
| **B2B Credibility** | Professional customers expect a dashboard |
| **Dispute Reduction** | Self-service status checks reduce support tickets |
| **Audit Compliance** | Customers can access their own records |
| **Billing Transparency** | Clear visibility into completed work and charges |

### Why It Won't Overload the System

A minimal, read-optimized portal does not materially impact system load:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       WHY PORTAL DOESN'T IMPACT PERFORMANCE                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. READ-ONLY ENDPOINTS                                                 │    │
│  │     • No writes to critical tables                                      │    │
│  │     • No contention with worker operations                              │    │
│  │     • Can use read replicas if needed (future)                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  2. PAGINATION + FILTERING                                              │    │
│  │     • No unbounded queries                                              │    │
│  │     • Maximum page size enforced (e.g., 50 items)                       │    │
│  │     • Cursor-based pagination for efficiency                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  3. CACHING / ETAG                                                      │    │
│  │     • ETag headers for conditional requests                             │    │
│  │     • 304 Not Modified reduces bandwidth                                │    │
│  │     • Summary views cached aggressively                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  4. SSE FOR UPDATES (instead of tight polling)                          │    │
│  │     • Server-Sent Events for real-time updates                          │    │
│  │     • Single long-lived connection per client                           │    │
│  │     • No repeated HTTP request overhead                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Read-Optimized Portal Model

> **Scope:** [MVP REQUIRED]

### 3.1 The Problem: Avoid Reading Raw job_events

The `job_events` table is append-only and grows rapidly (~50,000 rows/day). Querying it directly for each UI view would:

- Create expensive full-table scans
- Compete with worker writes
- Slow down as table grows

**Solution:** Maintain summary projections that are updated on each state transition.

### 3.2 Summary Projection Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      SUMMARY PROJECTION ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  State Transition Occurs                                                         │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  WRITE PATH (Worker)                                                    │    │
│  │                                                                         │    │
│  │  1. Append to job_events (audit log - always)                           │    │
│  │  2. UPDATE job_status_summary (for portal queries)                      │    │
│  │  3. INSERT INTO job_timeline_compact (last N transitions)               │    │
│  │  4. Enqueue notification task (if applicable)                           │    │
│  │                                                                         │    │
│  │  All in single transaction for consistency                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  READ PATH (Portal)                                                     │    │
│  │                                                                         │    │
│  │  Job List:   SELECT * FROM job_status_summary WHERE tenant_id = ?       │    │
│  │  Job Detail: SELECT * FROM job_timeline_compact WHERE job_id = ?        │    │
│  │                                                                         │    │
│  │  • No job_events scans                                                  │    │
│  │  • Indexed on tenant_id, job_id                                         │    │
│  │  • Bounded result sets                                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 job_status_summary Table

This table provides a denormalized view of current job state for fast list queries.

| Column | Type | Description |
|--------|------|-------------|
| `tenant_id` | UUID | Tenant identifier (partition key for queries) |
| `job_id` | UUID | Job identifier (primary key) |
| `current_state` | ENUM | Current FSM state (QUEUED, PROCESSING, etc.) |
| `status` | TEXT | Human-readable status text |
| `priority` | INTEGER | Job priority |
| `last_transition_at` | TIMESTAMPTZ | When state last changed |
| `last_error_code` | TEXT | Most recent error code (nullable) |
| `last_error_message` | TEXT | Human-readable error (nullable) |
| `hitl_pending` | BOOLEAN | Is HITL task currently pending? |
| `hitl_expires_at` | TIMESTAMPTZ | When HITL task expires (nullable) |
| `evidence_pack_id` | UUID | Reference to sealed evidence (nullable) |
| `created_at` | TIMESTAMPTZ | Job creation time |
| `completed_at` | TIMESTAMPTZ | Job completion time (nullable) |

**Indexes:**

```sql
-- Primary lookup
CREATE INDEX idx_job_status_summary_tenant 
ON job_status_summary (tenant_id, created_at DESC);

-- Status filtering
CREATE INDEX idx_job_status_summary_state 
ON job_status_summary (tenant_id, current_state);

-- HITL pending filter
CREATE INDEX idx_job_status_summary_hitl 
ON job_status_summary (tenant_id) 
WHERE hitl_pending = true;
```

### 3.4 job_timeline_compact Table

This table stores the last N state transitions for the job detail view.

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL | Auto-incrementing ID |
| `job_id` | UUID | Job identifier |
| `tenant_id` | UUID | Tenant identifier |
| `from_state` | TEXT | Previous state |
| `to_state` | TEXT | New state |
| `transition_at` | TIMESTAMPTZ | When transition occurred |
| `message` | TEXT | Human-readable description |
| `is_error` | BOOLEAN | Was this an error transition? |

**Bounded Storage:**

```sql
-- Keep only last 20 transitions per job
-- Trigger or application logic deletes older entries
DELETE FROM job_timeline_compact 
WHERE job_id = $1 
AND id NOT IN (
  SELECT id FROM job_timeline_compact 
  WHERE job_id = $1 
  ORDER BY transition_at DESC 
  LIMIT 20
);
```

### 3.5 Update Mechanism (Event-Driven)

On each state transition, the worker performs these operations atomically:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        STATE TRANSITION UPDATE FLOW                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  BEGIN TRANSACTION;                                                              │
│                                                                                  │
│  -- 1. Append to audit log (always)                                             │
│  INSERT INTO job_events (job_id, tenant_id, event_type, payload, created_at)    │
│  VALUES ($job_id, $tenant_id, 'STATE_TRANSITION', $payload, now());             │
│                                                                                  │
│  -- 2. Update summary projection (for portal)                                   │
│  UPDATE job_status_summary SET                                                   │
│    current_state = $new_state,                                                   │
│    status = $status_text,                                                        │
│    last_transition_at = now(),                                                   │
│    last_error_code = $error_code,                                                │
│    hitl_pending = $hitl_pending,                                                 │
│    completed_at = CASE WHEN $new_state IN ('COMPLETED','FAILED_TERMINAL')       │
│                        THEN now() ELSE completed_at END                          │
│  WHERE job_id = $job_id;                                                         │
│                                                                                  │
│  -- 3. Add to compact timeline (for detail view)                                │
│  INSERT INTO job_timeline_compact                                                │
│    (job_id, tenant_id, from_state, to_state, transition_at, message, is_error)  │
│  VALUES ($job_id, $tenant_id, $old_state, $new_state, now(), $message, $is_err);│
│                                                                                  │
│  -- 4. Enqueue notification if applicable                                       │
│  INSERT INTO notification_queue (job_id, tenant_id, event_type, created_at)     │
│  SELECT $job_id, $tenant_id, $event_type, now()                                  │
│  WHERE $new_state IN ('COMPLETED', 'FAILED_TERMINAL', 'WAITING_HITL');          │
│                                                                                  │
│  COMMIT;                                                                         │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. UI Update Strategy

> **Scope:** [MVP REQUIRED]

### 4.1 Default: Polling (Safe & Simple)

For initial implementation, polling is the safest approach:

| Configuration | Value | Rationale |
|---------------|-------|-----------|
| **Poll Interval (List)** | 30 seconds | Reasonable freshness for job lists |
| **Poll Interval (Detail)** | 10 seconds | More frequent for active job monitoring |
| **Max Page Size** | 50 items | Prevent unbounded queries |

**ETag Implementation:**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            ETAG CACHING FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Client Request                                                                  │
│  GET /api/portal/jobs                                                           │
│  If-None-Match: "abc123"                                                        │
│       │                                                                          │
│       ▼                                                                          │
│  Server checks: Has data changed since ETag "abc123"?                           │
│       │                                                                          │
│       ├─── NO (data unchanged) ──▶ 304 Not Modified                             │
│       │                            (no body, minimal bandwidth)                  │
│       │                                                                          │
│       └─── YES (data changed) ──▶ 200 OK                                        │
│                                   ETag: "def456"                                 │
│                                   Body: [updated job list]                       │
│                                                                                  │
│  Benefits:                                                                       │
│  • Reduces bandwidth for unchanged data                                          │
│  • Server can short-circuit response                                             │
│  • Client knows if refresh needed                                                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**ETag Generation:**

```typescript
// Generate ETag from latest modification timestamp
function generateETag(jobs: Job[]): string {
  const latestUpdate = Math.max(...jobs.map(j => j.last_transition_at.getTime()));
  return `"${latestUpdate.toString(36)}"`;
}
```

### 4.2 Recommended: Server-Sent Events (SSE)

For real-time updates without polling overhead:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SSE ARCHITECTURE                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐   │
│  │   Browser UI    │◀────────│   API Server    │◀────────│  Redis Pub/Sub  │   │
│  │                 │   SSE   │                 │ Subscribe│                 │   │
│  └─────────────────┘         └─────────────────┘         └─────────────────┘   │
│                                                                   ▲              │
│                                                                   │ Publish      │
│                                                           ┌───────┴───────┐     │
│                                                           │    Worker     │     │
│                                                           │ (on state     │     │
│                                                           │  transition)  │     │
│                                                           └───────────────┘     │
│                                                                                  │
│  Flow:                                                                           │
│  1. Client opens SSE connection: GET /api/portal/events                         │
│  2. Server subscribes to Redis channel: tenant:{tenant_id}:events               │
│  3. Worker publishes state changes to Redis                                      │
│  4. Server pushes event to client via SSE                                        │
│  5. Client fetches updated data on demand                                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**SSE Event Format:**

```typescript
// Server sends
event: job_updated
data: {"job_id": "uuid-123", "new_state": "COMPLETED", "timestamp": "2026-01-25T10:30:00Z"}

event: hitl_required
data: {"job_id": "uuid-456", "expires_at": "2026-01-25T12:00:00Z"}
```

**Client Handling:**

```typescript
const eventSource = new EventSource('/api/portal/events');

eventSource.addEventListener('job_updated', (event) => {
  const data = JSON.parse(event.data);
  // Refresh the specific job in UI
  refreshJobInList(data.job_id);
});

eventSource.addEventListener('hitl_required', (event) => {
  const data = JSON.parse(event.data);
  // Show HITL notification
  showHitlAlert(data.job_id, data.expires_at);
});
```

### 4.3 Comparison

| Aspect | Polling | SSE |
|--------|---------|-----|
| **Latency** | Up to poll interval | Near real-time |
| **Server Load** | Higher (repeated requests) | Lower (single connection) |
| **Complexity** | Simple | Moderate |
| **Browser Support** | Universal | Modern browsers |
| **Recommendation** | Start here | Migrate to SSE later |

---

## 7. Notifications

> **Scope:** [MVP REQUIRED]

### 5.1 Notification Channels

| Channel | Use Case | Cost | Reliability |
|---------|----------|------|-------------|
| **Email** | Default for all notifications | Low | High |
| **Webhook** | Enterprise integrations, automation | Low | High (with retries) |
| **SMS** | Critical alerts only | High | Medium |

### 5.2 Notification Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        NOTIFICATION SYSTEM ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  State Transition                                                                │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Should notify? (check trigger conditions)                              │    │
│  │  • Is this a notifiable event?                                          │    │
│  │  • Does tenant have notifications enabled?                              │    │
│  │  • Is this channel configured?                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ├─── NO ──▶ (no action)                                                   │
│       │                                                                          │
│       ▼ YES                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Enqueue to notification_queue                                          │    │
│  │  (same transaction as state update)                                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Notification Worker (separate process/queue)                           │    │
│  │  • Dequeue pending notifications                                        │    │
│  │  • Send via appropriate channel (Email/Webhook/SMS)                     │    │
│  │  • Mark as sent or failed                                               │    │
│  │  • Retry on transient failures                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Notification Triggers

| Trigger Event | Email | Webhook | SMS | Priority |
|---------------|-------|---------|-----|----------|
| `COMPLETED` | ✅ | ✅ | ❌ | Normal |
| `FAILED_RETRYABLE` | ❌ | ✅ | ❌ | Low |
| `FAILED_TERMINAL` | ✅ | ✅ | Optional | High |
| `WAITING_HITL` (created) | ✅ | ✅ | Optional | High |
| `HITL_EXPIRED` | ✅ | ✅ | ✅ | Critical |
| `EVIDENCE_PACK_SEALED` | ✅ | ✅ | ❌ | Normal |
| `BILLING_ELIGIBLE` | ✅ | ✅ | ❌ | Normal |
| `PORTAL_CHANGE_DETECTED` | ✅ (admin) | ✅ | ❌ | High |

### 5.4 Notification Queue Schema

```sql
CREATE TYPE notification_status AS ENUM (
  'PENDING',
  'SENDING',
  'SENT',
  'FAILED',
  'CANCELLED'
);

CREATE TYPE notification_channel AS ENUM (
  'EMAIL',
  'WEBHOOK',
  'SMS'
);

CREATE TABLE notification_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  job_id        UUID NOT NULL,
  channel       notification_channel NOT NULL,
  event_type    TEXT NOT NULL,
  recipient     TEXT NOT NULL,
  payload       JSONB NOT NULL,
  status        notification_status NOT NULL DEFAULT 'PENDING',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  last_attempt  TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ
);

-- Index for pending notifications
CREATE INDEX idx_notification_queue_pending 
ON notification_queue (status, created_at) 
WHERE status IN ('PENDING', 'FAILED');
```

### 5.5 Retry Strategy

| Attempt | Delay | Action |
|---------|-------|--------|
| 1 | Immediate | First send attempt |
| 2 | 5 minutes | Retry after transient failure |
| 3 | 30 minutes | Final retry |
| 4+ | N/A | Mark as FAILED, alert operations |

### 5.6 Notification Rate Limiting (Anti-Spam)

To prevent "notification storms" (e.g., a retry loop sending 50 SMS messages to a customer), rate limiting is **REQUIRED** at both job and channel levels.

**Rate Limit Rules:**

| Channel | Per-Job Limit | Per-Tenant Daily Limit | Notes |
|---------|---------------|------------------------|-------|
| **Email** | 5/day | 500/day | Transactional emails only |
| **SMS** | 3/day | 100/day | Most expensive, most intrusive |
| **Webhook** | Unlimited | Unlimited | Customer's responsibility to handle |

**Implementation:**

```sql
-- Add rate limit tracking columns to notification_queue
ALTER TABLE notification_queue ADD COLUMN rate_limit_key TEXT;

-- Rate limit check query (run before enqueue)
SELECT COUNT(*) as sent_count
FROM notification_queue
WHERE job_id = $job_id
  AND channel = $channel
  AND created_at > now() - INTERVAL '24 hours'
  AND status IN ('SENT', 'PENDING', 'SENDING');

-- If sent_count >= limit, DO NOT enqueue
```

**Notification Worker Guard:**

```typescript
async function shouldSendNotification(
  jobId: string, 
  tenantId: string, 
  channel: NotificationChannel
): Promise<boolean> {
  const limits = {
    EMAIL: { perJob: 5, perTenantDaily: 500 },
    SMS: { perJob: 3, perTenantDaily: 100 },
    WEBHOOK: { perJob: Infinity, perTenantDaily: Infinity }
  };
  
  const limit = limits[channel];
  
  // Check per-job limit
  const jobCount = await db.query(`
    SELECT COUNT(*) FROM notification_queue 
    WHERE job_id = $1 AND channel = $2 
      AND created_at > now() - INTERVAL '24 hours'
      AND status IN ('SENT', 'PENDING', 'SENDING')
  `, [jobId, channel]);
  
  if (jobCount >= limit.perJob) {
    logger.warn({ jobId, channel }, 'Per-job notification limit reached');
    return false;
  }
  
  // Check per-tenant daily limit
  const tenantCount = await db.query(`
    SELECT COUNT(*) FROM notification_queue 
    WHERE tenant_id = $1 AND channel = $2 
      AND created_at > now() - INTERVAL '24 hours'
      AND status IN ('SENT', 'PENDING', 'SENDING')
  `, [tenantId, channel]);
  
  if (tenantCount >= limit.perTenantDaily) {
    logger.warn({ tenantId, channel }, 'Per-tenant daily limit reached');
    return false;
  }
  
  return true;
}
```

**State-Change Notification Policy:**

To further reduce spam, only **terminal** or **actionable** state changes trigger notifications:

| State Change | Notify? | Rationale |
|--------------|---------|-----------|
| `QUEUED` | ❌ | Too early, nothing actionable |
| `LOGIN_PROCESS` | ❌ | Internal state |
| `FORM_FILLING` | ❌ | Internal state |
| `WAITING_HITL` | ✅ | **Actionable**: Human intervention needed |
| `PAUSED` | ❌ | Usually operator action, not customer concern |
| `COMPLETED` | ✅ | **Terminal**: Customer should know |
| `FAILED_RETRYABLE` | ❌ | System will auto-retry |
| `FAILED_TERMINAL` | ✅ | **Terminal**: Customer should know |
| `EVIDENCE_PACK_SEALED` | ✅ | Billing-related, customer should know |

### 5.7 Cron Reconciliation (Safety Net)

### 5.8 Portal Change Detection (Canary)

To reduce breakages when visa portals change their UI/DOM, run **canary jobs** per portal on a schedule (e.g., every 30–60 minutes):

- Canary performs a minimal flow (reach login page, locate critical selectors)
- If selectors/DOM deviate beyond threshold, emit `PORTAL_CHANGE_DETECTED`
- System notifies admins (email + webhook) and links to the canary artifact (screenshot/diff summary)

This supports proactive redesign of portal adapters before production runs fail.

While notifications are primarily event-driven, a cron job provides a safety net:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CRON RECONCILIATION JOB                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Schedule: Every 5-15 minutes                                                    │
│                                                                                  │
│  Tasks:                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. RECONCILE MISSED SENDS                                              │    │
│  │     Find terminal jobs (COMPLETED, FAILED_TERMINAL) with no             │    │
│  │     notification sent. Enqueue missing notifications.                   │    │
│  │                                                                         │    │
│  │     SELECT j.* FROM jobs j                                              │    │
│  │     LEFT JOIN notification_queue n ON j.id = n.job_id                   │    │
│  │     WHERE j.status IN ('COMPLETED', 'FAILED_TERMINAL')                  │    │
│  │       AND j.completed_at > now() - INTERVAL '24 hours'                  │    │
│  │       AND n.id IS NULL;                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  2. RETRY FAILED NOTIFICATIONS                                          │    │
│  │     Re-attempt notifications that failed due to provider outage.        │    │
│  │                                                                         │    │
│  │     UPDATE notification_queue                                           │    │
│  │     SET status = 'PENDING', attempts = attempts                         │    │
│  │     WHERE status = 'FAILED'                                             │    │
│  │       AND attempts < max_attempts                                       │    │
│  │       AND last_attempt < now() - INTERVAL '30 minutes';                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  3. ALERT ON STUCK NOTIFICATIONS                                        │    │
│  │     Alert operations if notifications are consistently failing.         │    │
│  │                                                                         │    │
│  │     SELECT COUNT(*) FROM notification_queue                             │    │
│  │     WHERE status = 'FAILED'                                             │    │
│  │       AND attempts >= max_attempts;                                     │    │
│  │     -- If count > threshold, send alert                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Security & Privacy

> **Scope:** [MVP REQUIRED]

### 6.1 Tenant Isolation

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TENANT ISOLATION MODEL                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Every portal request:                                                           │
│                                                                                  │
│  1. AUTHENTICATE                                                                 │
│     └── Validate JWT token                                                       │
│     └── Extract tenant_id from token claims                                      │
│                                                                                  │
│  2. AUTHORIZE                                                                    │
│     └── Verify user belongs to tenant                                            │
│     └── Check role permissions (admin, viewer, etc.)                             │
│                                                                                  │
│  3. FILTER                                                                       │
│     └── ALL queries include: WHERE tenant_id = $authenticated_tenant_id         │
│     └── Server-side enforcement (never trust client)                             │
│                                                                                  │
│  4. AUDIT                                                                        │
│     └── Log access to sensitive data                                             │
│     └── Log downloads (evidence packs)                                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 PII Protection

| Rule | Implementation |
|------|----------------|
| **No PII in logs** | Mask or hash sensitive fields before logging |
| **UI masking** | Show partial passport numbers, masked names where appropriate |
| **Encryption at rest** | Evidence packs encrypted on disk |
| **Encryption in transit** | HTTPS only (enforced by Kong) |

### 6.3 Evidence Pack Downloads

Evidence packs contain sensitive data and must be protected:

**Option A: Signed URLs (Preferred)**
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          SIGNED URL DOWNLOAD FLOW                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. Client requests download link                                                │
│     GET /api/portal/jobs/{id}/evidence-pack                                     │
│                                                                                  │
│  2. Server generates signed URL                                                  │
│     • URL valid for 15 minutes                                                   │
│     • Includes signature that can't be forged                                    │
│     • Logs download request                                                      │
│                                                                                  │
│  3. Server returns signed URL                                                    │
│     { "download_url": "https://storage/pack.zip?sig=xxx&exp=yyy" }              │
│                                                                                  │
│  4. Client downloads directly from storage                                       │
│     • Bypasses API server                                                        │
│     • Reduces API load                                                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Option B: Authenticated Download via Kong**
```
GET /api/portal/jobs/{id}/evidence-pack/download
Authorization: Bearer <token>
→ Server streams file through Kong
→ Higher load on API server, but simpler infrastructure
```

### 6.4 Audit Logging

All portal access must be audited:

```sql
CREATE TABLE portal_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   UUID,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Example actions: VIEW_JOB_LIST, VIEW_JOB_DETAIL, DOWNLOAD_EVIDENCE_PACK
```

---

## 9. Minimum Employer View

> **Scope:** [PHASED / LATER]

### 7.1 Job List View

| Column | Source | Description |
|--------|--------|-------------|
| **Status** | `current_state` | Current FSM state with icon/color |
| **Created** | `created_at` | When job was submitted |
| **Last Update** | `last_transition_at` | When status last changed |
| **Priority** | `priority` | VIP, Normal, Low |
| **Applicant** | `job_data` | Name (partially masked) |
| **Actions** | - | View details, download evidence |

**Filters:**
- Status (dropdown: All, In Progress, Completed, Failed, HITL Pending)
- Date range (created_at)
- Search (job ID, applicant name)

**Sorting:**
- Last updated (default, descending)
- Created date
- Priority

### 7.2 Job Detail View

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            JOB DETAIL VIEW                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  JOB HEADER                                                             │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Job ID: VS-2026-001234                    Status: ● PROCESSING         │    │
│  │  Applicant: John D***                      Priority: VIP                │    │
│  │  Created: Jan 25, 2026 10:00 AM            Last Update: 2 min ago       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  HITL ALERT (if pending)                                                │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  ⚠️ Human verification required                                         │    │
│  │  Expires in: 2 hours 15 minutes                                         │    │
│  │  Contact support if you need to provide information.                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  TIMELINE (Compact)                                                     │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  ● Jan 25, 10:30 AM - Processing application                            │    │
│  │  ● Jan 25, 10:15 AM - Logged in to portal                               │    │
│  │  ● Jan 25, 10:05 AM - Started processing                                │    │
│  │  ○ Jan 25, 10:00 AM - Job submitted                                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  RESULT (if completed)                                                  │    │
│  │  ─────────────────────────────────────────────────────────────────────  │    │
│  │  Confirmation Number: VISA-2026-ABC123                                  │    │
│  │  Appointment Date: Feb 15, 2026 at 9:00 AM                              │    │
│  │                                                                         │    │
│  │  📦 Download Evidence Pack                                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Database Schema Additions

> **Scope:** [MVP REQUIRED]

### 8.1 Complete Schema for Portal

```sql
-- ============================================
-- job_status_summary (portal list view)
-- ============================================
CREATE TABLE job_status_summary (
  job_id              UUID PRIMARY KEY,
  tenant_id           UUID NOT NULL,
  current_state       TEXT NOT NULL,
  status_text         TEXT NOT NULL,
  priority            INTEGER NOT NULL DEFAULT 0,
  applicant_name      TEXT,
  last_transition_at  TIMESTAMPTZ NOT NULL,
  last_error_code     TEXT,
  last_error_message  TEXT,
  hitl_pending        BOOLEAN NOT NULL DEFAULT false,
  hitl_expires_at     TIMESTAMPTZ,
  evidence_pack_id    UUID,
  confirmation_number TEXT,
  created_at          TIMESTAMPTZ NOT NULL,
  completed_at        TIMESTAMPTZ
);

CREATE INDEX idx_job_status_summary_tenant_created 
ON job_status_summary (tenant_id, created_at DESC);

CREATE INDEX idx_job_status_summary_tenant_state 
ON job_status_summary (tenant_id, current_state);

CREATE INDEX idx_job_status_summary_hitl 
ON job_status_summary (tenant_id, hitl_expires_at) 
WHERE hitl_pending = true;

-- ============================================
-- job_timeline_compact (portal detail view)
-- ============================================
CREATE TABLE job_timeline_compact (
  id              BIGSERIAL PRIMARY KEY,
  job_id          UUID NOT NULL,
  tenant_id       UUID NOT NULL,
  from_state      TEXT,
  to_state        TEXT NOT NULL,
  transition_at   TIMESTAMPTZ NOT NULL,
  message         TEXT NOT NULL,
  is_error        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_job_timeline_job 
ON job_timeline_compact (job_id, transition_at DESC);

-- ============================================
-- evidence_packs (completed job artifacts)
-- ============================================
CREATE TABLE evidence_packs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID NOT NULL UNIQUE,
  tenant_id       UUID NOT NULL,
  storage_path    TEXT NOT NULL,
  checksum        TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  sealed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ
);

CREATE INDEX idx_evidence_packs_tenant 
ON evidence_packs (tenant_id);

-- ============================================
-- portal_audit_log (access tracking)
-- ============================================
CREATE TABLE portal_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  user_id         UUID NOT NULL,
  action          TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     UUID,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_portal_audit_tenant_time 
ON portal_audit_log (tenant_id, created_at DESC);
```

---

## 11. API Endpoints

> **Scope:** [MVP REQUIRED]

### 9.1 Portal API Routes


### 9.3 Admin Ops Routes (Agent Fleet)

These routes are used by the admin/settings area (not customer-facing):

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/admin/portal-policies` | List per-portal scheduling/limit policies |
| `PUT` | `/admin/portal-policies/:portal_id` | Update portal policy (SERIAL/PARALLEL, max concurrency, enabled) |
| `GET` | `/admin/agents` | List agents and their assignments |
| `PATCH` | `/admin/agents/:id` | Enable/disable agent and update assigned portals |


| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/portal/jobs` | List jobs for tenant (paginated) |
| `GET` | `/api/portal/jobs/:id` | Get job detail |
| `GET` | `/api/portal/jobs/:id/timeline` | Get job timeline |
| `GET` | `/api/portal/jobs/:id/evidence-pack` | Get evidence pack download URL |
| `GET` | `/api/portal/events` | SSE endpoint for real-time updates |
| `GET` | `/api/portal/stats` | Dashboard statistics |

### 9.2 Request/Response Examples

**List Jobs:**
```http
GET /api/portal/jobs?page=1&limit=20&status=PROCESSING
Authorization: Bearer <token>
If-None-Match: "abc123"

Response (200 OK):
{
  "data": [
    {
      "job_id": "uuid-123",
      "current_state": "PROCESSING",
      "status_text": "Processing application",
      "priority": 10,
      "applicant_name": "John D***",
      "last_transition_at": "2026-01-25T10:30:00Z",
      "hitl_pending": false,
      "created_at": "2026-01-25T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "has_more": true
  }
}
ETag: "def456"
```

**Job Detail:**
```http
GET /api/portal/jobs/uuid-123
Authorization: Bearer <token>

Response (200 OK):
{
  "job_id": "uuid-123",
  "current_state": "COMPLETED",
  "status_text": "Application submitted successfully",
  "priority": 10,
  "applicant_name": "John D***",
  "last_transition_at": "2026-01-25T11:00:00Z",
  "hitl_pending": false,
  "confirmation_number": "VISA-2026-ABC123",
  "evidence_pack_available": true,
  "created_at": "2026-01-25T10:00:00Z",
  "completed_at": "2026-01-25T11:00:00Z",
  "timeline": [
    {
      "state": "COMPLETED",
      "message": "Application submitted successfully",
      "timestamp": "2026-01-25T11:00:00Z"
    },
    {
      "state": "PROCESSING",
      "message": "Submitting application",
      "timestamp": "2026-01-25T10:45:00Z"
    }
  ]
}
```

---

## 12. Implementation Checklist

> **Scope:** [MVP REQUIRED]

### Phase 1: Core Portal (MVP)

- [ ] **Database**
  - [ ] Create `job_status_summary` table
  - [ ] Create `job_timeline_compact` table
  - [ ] Add update logic to worker state transitions
  - [ ] Add indexes for portal queries

- [ ] **API**
  - [ ] Implement `/api/portal/jobs` (list with pagination)
  - [ ] Implement `/api/portal/jobs/:id` (detail)
  - [ ] Add ETag support for caching
  - [ ] Add tenant isolation middleware

- [ ] **UI**
  - [ ] Job list view with filters
  - [ ] Job detail view with timeline
  - [ ] Polling implementation (30s refresh)

### Phase 2: Notifications

- [ ] **Database**
  - [ ] Create `notification_queue` table
  - [ ] Add notification triggers to state transitions

- [ ] **Notification Worker**
  - [ ] Email sending integration
  - [ ] Webhook delivery with retries
  - [ ] Cron reconciliation job

- [ ] **Configuration**
  - [ ] Per-tenant notification preferences
  - [ ] Channel configuration (email addresses, webhook URLs)

### Phase 3: Enhanced Features

- [ ] **Real-time Updates**
  - [ ] Implement SSE endpoint
  - [ ] Add Redis pub/sub for events
  - [ ] Update UI to use SSE

- [ ] **Evidence Packs**
  - [ ] Create `evidence_packs` table
  - [ ] Implement signed URL generation
  - [ ] Add download audit logging

- [ ] **Audit & Compliance**
  - [ ] Create `portal_audit_log` table
  - [ ] Log all portal access
  - [ ] PII masking in UI

### Verification Checklist

- [ ] Summary projections exist (no heavy scans on job_events)
- [ ] Pagination enforced on all list endpoints
- [ ] ETag enabled for polling endpoints
- [ ] Notifications are event-driven (not cron-based)
- [ ] Cron reconciliation enabled as safety net
- [ ] Evidence pack downloads are audited
- [ ] Tenant isolation enforced on all queries
- [ ] No PII in application logs

---

## 13. UI Development Guide

> **Scope:** [PHASED / LATER]

### 13.1 Technology Stack & Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     PORTAL UI TECHNOLOGY STACK                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  FRAMEWORK: Next.js 14+ (App Router)                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Why Next.js:                                                           │    │
│  │  • Server-side rendering for initial load performance                   │    │
│  │  • API routes for BFF (Backend-for-Frontend) pattern                    │    │
│  │  • Built-in middleware for auth checks                                  │    │
│  │  • File-based routing matches portal structure                          │    │
│  │  • Edge-compatible for future CDN deployment                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  UI LIBRARY: React 18+                                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Key Patterns:                                                          │    │
│  │  • Server Components for data fetching (default)                        │    │
│  │  • Client Components for interactivity ('use client')                   │    │
│  │  • Suspense boundaries for loading states                               │    │
│  │  • Error boundaries for graceful failures                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STYLING: Tailwind CSS + shadcn/ui                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Utility-first for rapid development                                  │    │
│  │  • shadcn/ui for accessible, customizable components                    │    │
│  │  • Dark mode support built-in                                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STATE MANAGEMENT: TanStack Query (React Query)                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Automatic caching and background refetching                          │    │
│  │  • Built-in stale-while-revalidate                                      │    │
│  │  • Integrates with ETag/polling strategy                                │    │
│  │  • Optimistic updates for better UX                                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 13.2 Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     PORTAL AUTHENTICATION FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  TOKEN STORAGE STRATEGY                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                         │    │
│  │  Access Token:  Memory only (React state / context)                     │    │
│  │  ├── NEVER stored in localStorage (XSS vulnerable)                      │    │
│  │  ├── Short-lived (1 hour)                                               │    │
│  │  └── Refreshed silently via refresh token                               │    │
│  │                                                                         │    │
│  │  Refresh Token: HTTP-only, Secure, SameSite=Strict cookie               │    │
│  │  ├── Inaccessible to JavaScript (XSS protection)                        │    │
│  │  ├── Long-lived (7 days)                                                │    │
│  │  └── Rotated on each refresh                                            │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  LOGIN FLOW                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                         │    │
│  │  1. User enters credentials on /login                                   │    │
│  │  2. POST /api/auth/login (Next.js API route)                            │    │
│  │  3. API route calls backend auth service                                │    │
│  │  4. On success:                                                         │    │
│  │     • Set refresh_token as HTTP-only cookie                             │    │
│  │     • Return access_token in response body                              │    │
│  │  5. Client stores access_token in AuthContext                           │    │
│  │  6. Redirect to /dashboard                                              │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  TOKEN REFRESH FLOW                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                         │    │
│  │  1. Access token expires (or 401 received)                              │    │
│  │  2. Call POST /api/auth/refresh                                         │    │
│  │     • refresh_token sent automatically via cookie                       │    │
│  │  3. Backend validates refresh token                                     │    │
│  │  4. On success:                                                         │    │
│  │     • New refresh_token set as cookie (rotation)                        │    │
│  │     • New access_token returned                                         │    │
│  │  5. On failure (expired/revoked):                                       │    │
│  │     • Clear auth state                                                  │    │
│  │     • Redirect to /login                                                │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  CSRF PROTECTION                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                         │    │
│  │  Strategy: Double Submit Cookie                                         │    │
│  │                                                                         │    │
│  │  1. Server sets csrf_token as regular cookie (readable by JS)           │    │
│  │  2. Client includes csrf_token in X-CSRF-Token header                   │    │
│  │  3. Server validates header matches cookie                              │    │
│  │                                                                         │    │
│  │  Why not SameSite alone?                                                │    │
│  │  • Extra layer of defense                                               │    │
│  │  • Protects against subdomain attacks                                   │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Auth Context Implementation:**

```typescript
// contexts/AuthContext.tsx
'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface AuthState {
  accessToken: string | null;
  user: User | null;
  isLoading: boolean;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    accessToken: null,
    user: null,
    isLoading: true,
  });

  // Attempt silent refresh on mount
  useEffect(() => {
    refreshToken().finally(() => {
      setState(prev => ({ ...prev, isLoading: false }));
    });
  }, []);

  const refreshToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include', // Include cookies
      });
      
      if (!res.ok) {
        setState({ accessToken: null, user: null, isLoading: false });
        return null;
      }
      
      const { accessToken, user } = await res.json();
      setState({ accessToken, user, isLoading: false });
      return accessToken;
    } catch {
      setState({ accessToken: null, user: null, isLoading: false });
      return null;
    }
  }, []);

  // ... login, logout implementations
  
  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshToken }}>
      {children}
    </AuthContext.Provider>
  );
}
```

### 13.3 Screen/Role Matrix

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SCREEN ACCESS BY ROLE                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Screen               │ Admin │ Operator │ Viewer │ Notes                        │
│  ─────────────────────┼───────┼──────────┼────────┼──────────────────────────────│
│  Dashboard            │  ✅   │    ✅    │   ✅   │ Metrics differ by role        │
│  Job List             │  ✅   │    ✅    │   ✅   │ All can view                  │
│  Job Detail           │  ✅   │    ✅    │   ✅   │ PII masking for viewer        │
│  Job Create           │  ✅   │    ✅    │   ❌   │ Requires job:create           │
│  Job Actions          │  ✅   │    ✅    │   ❌   │ Cancel/Retry/Pause            │
│  HITL Task List       │  ✅   │    ✅    │   ✅   │ All can view                  │
│  HITL Task Resolve    │  ✅   │    ✅    │   ❌   │ Requires hitl:resolve         │
│  Evidence Pack View   │  ✅   │    ✅    │   ✅   │ Download requires audit       │
│  Billing Dashboard    │  ✅   │    👁️    │   👁️   │ View only for non-admin       │
│  Billing Settings     │  ✅   │    ❌    │   ❌   │ Admin only                    │
│  User Management      │  ✅   │    ❌    │   ❌   │ Admin only                    │
│  API Keys             │  ✅   │    ❌    │   ❌   │ Admin only                    │
│  Webhook Config       │  ✅   │    ❌    │   ❌   │ Admin only                    │
│  Audit Log            │  ✅   │    ❌    │   ❌   │ Admin only                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**PII Masking by Role (aligned with [VISA_DATA_PROTECTION.md](../security/VISA_DATA_PROTECTION.md)):**

| Field | Admin | Operator | Viewer |
|-------|-------|----------|--------|
| Full Name | `John Doe` | `John Doe` | `J*** D**` |
| Passport Number | `AB1234567` | `******567` | `******567` |
| Date of Birth | `1985-06-15` | `****-**-15` | `[REDACTED]` |
| Email | `john@example.com` | `j***@***.com` | `[REDACTED]` |
| Phone | `+1234567890` | `+1******890` | `[REDACTED]` |
| Address | Full | `[REDACTED]` | `[REDACTED]` |

**Role-Based Navigation:**

```typescript
// lib/navigation.ts
import { Role } from '@/types';

interface NavItem {
  label: string;
  href: string;
  icon: string;
  roles: Role[];
}

export const navigation: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: 'home', roles: ['admin', 'operator', 'viewer'] },
  { label: 'Jobs', href: '/jobs', icon: 'briefcase', roles: ['admin', 'operator', 'viewer'] },
  { label: 'HITL Tasks', href: '/hitl', icon: 'user-check', roles: ['admin', 'operator', 'viewer'] },
  { label: 'Evidence', href: '/evidence', icon: 'file-check', roles: ['admin', 'operator', 'viewer'] },
  { label: 'Billing', href: '/billing', icon: 'credit-card', roles: ['admin', 'operator', 'viewer'] },
  { label: 'Users', href: '/settings/users', icon: 'users', roles: ['admin'] },
  { label: 'API Keys', href: '/settings/api-keys', icon: 'key', roles: ['admin'] },
  { label: 'Webhooks', href: '/settings/webhooks', icon: 'webhook', roles: ['admin'] },
  { label: 'Audit Log', href: '/settings/audit', icon: 'scroll', roles: ['admin'] },
];

export function getNavForRole(role: Role): NavItem[] {
  return navigation.filter(item => item.roles.includes(role));
}
```

### 13.4 UI Data Refresh Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     DATA REFRESH STRATEGY MATRIX                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  PHASE 1: POLLING + ETAG (MVP, Default)                                 │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │                                                                         │    │
│  │  When: Initial deployment, < 50 concurrent portal users                 │    │
│  │                                                                         │    │
│  │  Implementation:                                                        │    │
│  │  • TanStack Query with refetchInterval                                  │    │
│  │  • Conditional fetching with ETag (If-None-Match)                       │    │
│  │  • 304 Not Modified = no data transfer                                  │    │
│  │                                                                         │    │
│  │  Intervals by screen:                                                   │    │
│  │  • Job List:       30 seconds                                           │    │
│  │  • Job Detail:     15 seconds (when in-progress)                        │    │
│  │  • HITL Task List: 10 seconds (time-sensitive)                          │    │
│  │  • Dashboard:      60 seconds                                           │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  PHASE 2: SSE (Server-Sent Events) - Scale Trigger                      │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │                                                                         │    │
│  │  When to upgrade:                                                       │    │
│  │  • > 50 concurrent portal users                                         │    │
│  │  • Polling causing measurable API load                                  │    │
│  │  • Users complaining about "stale" data                                 │    │
│  │                                                                         │    │
│  │  Implementation:                                                        │    │
│  │  • SSE endpoint: GET /api/events/stream                                 │    │
│  │  • Redis pub/sub for event distribution                                 │    │
│  │  • EventSource in browser with auto-reconnect                           │    │
│  │  • Fallback to polling if SSE fails                                     │    │
│  │                                                                         │    │
│  │  Events pushed:                                                         │    │
│  │  • job.status_changed                                                   │    │
│  │  • hitl.task_created                                                    │    │
│  │  • hitl.task_resolved                                                   │    │
│  │  • evidence.sealed                                                      │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  TRANSITION CRITERIA:                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                         │    │
│  │  Metric                      │ Threshold for SSE upgrade                │    │
│  │  ────────────────────────────┼─────────────────────────────────────────│    │
│  │  Concurrent portal users     │ > 50                                     │    │
│  │  Polling requests/minute     │ > 500                                    │    │
│  │  API p99 latency             │ > 200ms (polling overhead)               │    │
│  │  User feedback               │ "Data feels stale"                       │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**TanStack Query Configuration:**

```typescript
// lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,        // 30 seconds
      gcTime: 5 * 60 * 1000,       // 5 minutes
      refetchOnWindowFocus: true,
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

// hooks/useJobs.ts
export function useJobs(filters: JobFilters) {
  return useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => fetchJobs(filters),
    refetchInterval: 30 * 1000,  // Poll every 30 seconds
    // ETag handling
    meta: {
      etag: true,
    },
  });
}

// hooks/useJobDetail.ts
export function useJobDetail(jobId: string) {
  const { data: job } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => fetchJob(jobId),
    refetchInterval: (query) => {
      // Faster polling for in-progress jobs
      const status = query.state.data?.status;
      if (['QUEUED', 'LOGIN_PROCESS', 'FORM_FILLING', 'PROCESSING'].includes(status)) {
        return 15 * 1000;  // 15 seconds
      }
      return 60 * 1000;    // 1 minute for terminal states
    },
  });
  
  return job;
}
```

### 13.5 Error States & UX Patterns

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       ERROR STATE UX PATTERNS                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Each job/HITL state maps to specific UI treatment:                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Job State → UI Treatment

| State | Badge Color | Icon | User Message | Actions Available |
|-------|-------------|------|--------------|-------------------|
| `DRAFTED` | Gray | 📝 | "Draft - Not submitted" | Edit, Submit, Delete |
| `QUEUED` | Blue | ⏳ | "Waiting in queue" | Cancel |
| `LOGIN_PROCESS` | Blue (pulsing) | 🔐 | "Logging into portal..." | Cancel |
| `LOGGED_IN` | Blue | ✅ | "Logged in, preparing..." | Cancel |
| `FORM_FILLING` | Blue (pulsing) | 📋 | "Filling application form" | Pause |
| `PAUSED` | Yellow | ⏸️ | "Paused" | Resume, Cancel |
| `WAITING_HITL` | Orange | 🖐️ | "Needs your attention" | View HITL Task |
| `PROCESSING` | Blue (pulsing) | ⚙️ | "Submitting application..." | (none) |
| `COMPLETED` | Green | ✅ | "Completed successfully" | View Evidence |
| `FAILED_RETRYABLE` | Orange | ⚠️ | "Failed - Can retry" | Retry, View Details |
| `FAILED_TERMINAL` | Red | ❌ | "Failed permanently" | View Details, Support |

#### HITL Task State → UI Treatment

| State | UI Treatment | User Action |
|-------|--------------|-------------|
| `PENDING` | Highlighted card, countdown timer | "Resolve Now" button |
| `IN_PROGRESS` | "Being resolved by {user}" | Wait indicator |
| `EXPIRED` | Grayed out, strikethrough | "Task Expired" - no action |
| `RESOLVED` | Success checkmark | View resolution details |

**HITL Expiry Warning:**

```typescript
// components/HitlTaskCard.tsx
function HitlTaskCard({ task }: { task: HitlTask }) {
  const remainingMs = new Date(task.expires_at).getTime() - Date.now();
  const remainingMinutes = Math.floor(remainingMs / 60000);
  
  return (
    <Card className={cn(
      remainingMinutes < 5 && 'border-red-500 animate-pulse',
      remainingMinutes < 15 && 'border-orange-500',
    )}>
      {remainingMinutes < 5 && (
        <Alert variant="destructive">
          <AlertTitle>Expiring Soon!</AlertTitle>
          <AlertDescription>
            This task will expire in {remainingMinutes} minutes. 
            The job will fail if not resolved.
          </AlertDescription>
        </Alert>
      )}
      {/* ... task content */}
    </Card>
  );
}
```

#### Evidence Pack State → UI Treatment

| State | UI Treatment | Actions |
|-------|--------------|---------|
| `DRAFT` | "Generating..." with spinner | None |
| `SEALED` | "Ready to download" | Download, Verify |
| `REVOKED` | "Evidence revoked" warning | View reason |
| Download URL expired | "Link expired" | Request new link |

**Evidence Not Ready Pattern:**

```typescript
// components/EvidenceDownload.tsx
function EvidenceDownload({ jobId }: { jobId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['evidence', jobId],
    queryFn: () => fetchEvidenceMetadata(jobId),
    retry: (failureCount, error) => {
      // Keep retrying if evidence not sealed yet
      if (error.code === 'EVIDENCE_NOT_SEALED') {
        return failureCount < 10;
      }
      return failureCount < 3;
    },
    retryDelay: 5000, // Check every 5 seconds
  });

  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (error?.code === 'EVIDENCE_NOT_SEALED') {
    return (
      <Card className="bg-blue-50">
        <CardContent className="flex items-center gap-4 py-4">
          <Spinner />
          <div>
            <p className="font-medium">Evidence pack is being generated...</p>
            <p className="text-sm text-muted-foreground">
              This usually takes 1-2 minutes after job completion.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error?.code === 'EVIDENCE_REVOKED') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Evidence Revoked</AlertTitle>
        <AlertDescription>
          This evidence pack has been revoked. Contact support for details.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardContent>
        <Button onClick={() => downloadEvidence(jobId)}>
          <Download className="mr-2 h-4 w-4" />
          Download Evidence Pack
        </Button>
      </CardContent>
    </Card>
  );
}
```

#### Job Paused/Recovered Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     JOB PAUSE/RECOVERY UI FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PAUSE SCENARIOS:                                                                │
│                                                                                  │
│  1. User-initiated pause:                                                        │
│     ┌─────────────────────────────────────────────────────────────────────┐     │
│     │  Status: PAUSED                                                     │     │
│     │  Message: "Paused by {user} at {time}"                              │     │
│     │  Actions: [Resume] [Cancel]                                         │     │
│     └─────────────────────────────────────────────────────────────────────┘     │
│                                                                                  │
│  2. System-initiated pause (maintenance/incident):                               │
│     ┌─────────────────────────────────────────────────────────────────────┐     │
│     │  Status: PAUSED                                                     │     │
│     │  Badge: "System Maintenance"                                        │     │
│     │  Message: "Paused for scheduled maintenance. Will auto-resume."     │     │
│     │  Actions: [View Status] (no manual resume)                          │     │
│     └─────────────────────────────────────────────────────────────────────┘     │
│                                                                                  │
│  RECOVERY NOTIFICATIONS:                                                         │
│                                                                                  │
│  When job auto-recovers from crash/restart:                                      │
│     ┌─────────────────────────────────────────────────────────────────────┐     │
│     │  Toast: "Job #{id} recovered and resumed from checkpoint"           │     │
│     │  Timeline entry: "Auto-recovered after worker restart"              │     │
│     │  No user action required                                            │     │
│     └─────────────────────────────────────────────────────────────────────┘     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 13.6 UI Component Library Standards

| Component | Library | Notes |
|-----------|---------|-------|
| Buttons, Forms, Dialogs | shadcn/ui | Accessible, customizable |
| Data Tables | TanStack Table + shadcn | Sorting, filtering, pagination |
| Charts | Recharts | Dashboard metrics |
| Icons | Lucide React | Consistent iconography |
| Toast Notifications | Sonner | Non-blocking feedback |
| Date/Time | date-fns | Lightweight formatting |
| Forms | React Hook Form + Zod | Validation |

### 13.7 Accessibility Requirements

- [ ] All interactive elements keyboard accessible
- [ ] ARIA labels on icons and non-text elements
- [ ] Color contrast ratio ≥ 4.5:1 (WCAG AA)
- [ ] Focus indicators visible
- [ ] Screen reader tested (VoiceOver, NVDA)
- [ ] Reduced motion support (`prefers-reduced-motion`)
