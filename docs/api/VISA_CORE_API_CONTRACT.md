# Core API Contract Specification

## Full API Surface for Job Lifecycle, HITL, Evidence & Admin Operations

> **Document Status:** Locked Specification  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Architecture](../architecture/VISA_SAAS_ARCHITECTURE.md) | [Portal & Notifications](../api/VISA_PORTAL_AND_NOTIFICATIONS.md) | [Security Model](../security/VISA_SECURITY_MODEL.md) | [Database Schema](../database/VISA_DATABASE_SCHEMA.md)

---

## Scope Labels

This specification is intentionally **forward-looking**. To avoid roadmap drift, each major section is labeled:

- **[MVP REQUIRED]**: Must be implemented for v1 pilot.
- **[PHASED / LATER]**: Planned for later phases (keep as reference; do not block MVP).
- **[OPTIONAL]**: Implement only if/when needed.

---

## MVP API Surface Summary (v1 Pilot)

This is the minimal set that must exist for the system to operate end-to-end.

### Jobs
- `POST /jobs`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/pause`
- `POST /jobs/:id/resume`
- `POST /jobs/:id/retry`
- `POST /jobs/:id/cancel`

### HITL
- `GET /hitl/tasks`
- `GET /hitl/tasks/:id`
- `POST /hitl/tasks/:id/resolve`
- `POST /hitl/tasks/:id/escalate` *(recommended)*

### Admin / Ops
- `POST /admin/incident-mode`
- `GET /admin/health`

> Evidence and Webhooks exist in this spec as **[PHASED / LATER]** items.
> MVP uses “Light Evidence”: reference + date/time (+ optional screenshot), not sealed packs.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication & Authorization](#2-authentication--authorization)
3. [Request/Response Standards](#3-requestresponse-standards)
4. [Idempotency Semantics](#4-idempotency-semantics)
5. [Error Taxonomy](#5-error-taxonomy)
6. [Job Lifecycle Endpoints](#6-job-lifecycle-endpoints)
7. [HITL Endpoints](#7-hitl-endpoints)
8. [Evidence Pack Endpoints](#8-evidence-pack-endpoints)
9. [Admin Operations Endpoints](#9-admin-operations-endpoints)
10. [Webhook Delivery Contract](#10-webhook-delivery-contract)

---

## 1. Overview

### API Design Principles

> **Scope:** [MVP REQUIRED]

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          CORE API DESIGN PRINCIPLES                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. TENANT ISOLATION                                                             │
│     Every request is scoped to a tenant via JWT claims.                          │
│     Cross-tenant access is impossible at the API layer.                          │
│                                                                                  │
│  2. IDEMPOTENCY BY DEFAULT                                                       │
│     All mutating operations (POST/PUT/PATCH) MUST support Idempotency-Key.       │
│     Replaying a request with the same key returns the original response.         │
│                                                                                  │
│  3. EXPLICIT ERROR TAXONOMY                                                      │
│     Every error has a machine-readable code and human-readable message.          │
│     Errors map to FSM states for client retry decisions.                         │
│                                                                                  │
│  4. AUDIT TRAIL                                                                  │
│     All API calls are logged with tenant_id, user_id, action, timestamp.         │
│     Evidence pack access is separately audited.                                  │
│                                                                                  │
│  5. RATE LIMITING                                                                │
│     Per-tenant, per-endpoint rate limits enforced at Kong gateway.               │
│     429 responses include Retry-After header.                                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Base URL Structure

```
Production: https://api.visa-automation.example.com/v1
Staging:    https://api-staging.visa-automation.example.com/v1
```

### API Versioning

| Version | Status | Notes |
|---------|--------|-------|
| `v1` | **Current** | Locked specification |
| `v2` | Planned | Breaking changes require new version |

---

## 2. Authentication & Authorization

### 2.1 Authentication Methods

> **Scope:** [MVP REQUIRED]

| Method | Use Case | Header Format |
|--------|----------|---------------|
| **Bearer Token (JWT)** | API access | `Authorization: Bearer <token>` |
| **API Key** | Server-to-server | `X-API-Key: <key>` |
| **Webhook Signature** | Webhook verification | `X-Webhook-Signature: <hmac>` |

### 2.2 JWT Claims Structure

```json
{
  "sub": "user-uuid",
  "tenant_id": "tenant-uuid",
  "roles": ["operator"],
  "permissions": ["job:create", "job:read", "hitl:resolve"],
  "iat": 1706185200,
  "exp": 1706188800,
  "iss": "visa-automation"
}
```

### 2.3 RBAC Roles


> **RBAC Note:** `viewer` is **strictly read-only** (no POST/PUT/PATCH/DELETE on operational endpoints).  
> Operators who must resolve OTP/CAPTCHA should use `operator` role (HITL write permissions).

| Role | Description | Permissions |
|------|-------------|-------------|
| `admin` | Tenant administrator | All permissions |
| `operator` | Day-to-day operations | `job:*`, `hitl:*`, `evidence:read` |
| `viewer` | Read-only access | `job:read`, `evidence:read` |
| `system` | Internal services | All + admin ops |

### 2.4 Permission Matrix

| Endpoint | admin | operator | viewer | system |
|----------|-------|----------|--------|--------|
| `POST /jobs` | ✅ | ✅ | ❌ | ✅ |
| `GET /jobs` | ✅ | ✅ | ✅ | ✅ |
| `POST /jobs/:id/cancel` | ✅ | ✅ | ❌ | ✅ |
| `POST /jobs/:id/retry` | ✅ | ✅ | ❌ | ✅ |
| `POST /jobs/:id/pause` | ✅ | ✅ | ❌ | ✅ |
| `GET /hitl/tasks` | ✅ | ✅ | ✅ | ✅ |
| `POST /hitl/tasks/:id/resolve` | ✅ | ✅ | ❌ | ✅ |
| `GET /evidence/:job_id` | ✅ | ✅ | ✅ | ✅ |
| `GET /evidence/:job_id/download-url` | ✅ | ✅ | ✅ | ✅ |
| `POST /admin/incident-mode` | ✅ | ❌ | ❌ | ✅ |
| `POST /admin/worker/drain` | ✅ | ❌ | ❌ | ✅ |

---

## 3. Request/Response Standards

### 3.1 Common Request Headers

> **Scope:** [MVP REQUIRED]

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | ✅ | Bearer token or API key |
| `Content-Type` | ✅ (POST/PUT/PATCH) | `application/json` |
| `Idempotency-Key` | ✅ (mutations) | UUID v4 for idempotent requests |
| `X-Request-ID` | Recommended | Client-generated request ID for tracing |
| `Accept` | Optional | `application/json` (default) |

### 3.2 Standard Response Envelope

**Success Response:**

```json
{
  "success": true,
  "data": { /* response payload */ },
  "meta": {
    "request_id": "req-uuid",
    "timestamp": "2026-01-25T10:30:00Z"
  }
}
```

**Error Response:**

```json
{
  "success": false,
  "error": {
    "code": "JOB_NOT_FOUND",
    "message": "Job with ID 'abc123' not found",
    "details": {
      "job_id": "abc123"
    },
    "retry_after": null
  },
  "meta": {
    "request_id": "req-uuid",
    "timestamp": "2026-01-25T10:30:00Z"
  }
}
```

### 3.3 Pagination

All list endpoints use cursor-based pagination:

**Request:**
```
GET /jobs?limit=50&cursor=eyJpZCI6IjEyMyJ9
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [ /* job objects */ ],
    "pagination": {
      "limit": 50,
      "has_more": true,
      "next_cursor": "eyJpZCI6IjQ1NiJ9",
      "prev_cursor": "eyJpZCI6IjEwMCJ9"
    }
  }
}
```

---

## 4. Idempotency Semantics

### 4.1 Idempotency-Key Behavior

> **Scope:** [MVP REQUIRED]

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         IDEMPOTENCY-KEY LIFECYCLE                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Client sends: POST /jobs                                                        │
│  Headers: Idempotency-Key: "idem-key-123"                                        │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  FIRST REQUEST (key not seen before)                                    │    │
│  │  1. Store key + request hash in Redis: SETEX idem:idem-key-123 86400    │    │
│  │  2. Process request                                                     │    │
│  │  3. Store response with key: SET idem:idem-key-123:response {...}       │    │
│  │  4. Return response with header: Idempotency-Replayed: false            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  REPLAY REQUEST (same key within TTL)                                   │    │
│  │  1. Check Redis: EXISTS idem:idem-key-123 → true                        │    │
│  │  2. Verify request hash matches (same body)                             │    │
│  │  3. Return stored response with header: Idempotency-Replayed: true      │    │
│  │  4. Do NOT re-process request                                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  CONFLICT (same key, different body)                                    │    │
│  │  1. Check Redis: EXISTS idem:idem-key-123 → true                        │    │
│  │  2. Verify request hash → MISMATCH                                      │    │
│  │  3. Return 422 IDEMPOTENCY_KEY_CONFLICT                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  TTL: 24 hours (configurable)                                                    │
│  Storage: Redis with key prefix "idem:"                                          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Idempotency Response Headers

| Header | Value | Description |
|--------|-------|-------------|
| `Idempotency-Replayed` | `true` / `false` | Whether response is from cache |
| `Idempotency-Key-Expires` | ISO 8601 timestamp | When the key will expire |

### 4.3 Endpoints Requiring Idempotency-Key

| Endpoint | Required | Notes |
|----------|----------|-------|
| `POST /jobs` | ✅ MUST | Prevents duplicate job creation |
| `POST /jobs/:id/cancel` | ✅ MUST | Prevents race conditions |
| `POST /jobs/:id/retry` | ✅ MUST | Prevents duplicate retries |
| `POST /jobs/:id/pause` | ✅ MUST | Safe for retries |
| `POST /hitl/tasks/:id/resolve` | ✅ MUST | Prevents duplicate resolutions |
| `GET /jobs` | ❌ N/A | Read operations are naturally idempotent |
| `GET /evidence/:job_id` | ❌ N/A | Read operations are naturally idempotent |

---

## 5. Error Taxonomy

### 5.1 Error Code Categories

> **Scope:** [MVP REQUIRED]

| Prefix | Category | HTTP Status |
|--------|----------|-------------|
| `AUTH_*` | Authentication/Authorization | 401, 403 |
| `VALIDATION_*` | Request validation | 400 |
| `JOB_*` | Job lifecycle errors | 400, 404, 409 |
| `HITL_*` | HITL operation errors | 400, 404, 409 |
| `EVIDENCE_*` | Evidence pack errors | 404, 410 |
| `RATE_*` | Rate limiting | 429 |
| `SYSTEM_*` | Internal errors | 500, 503 |

### 5.2 Complete Error Code Reference

#### Authentication Errors (401, 403)

| Code | HTTP | Message | Retry? |
|------|------|---------|--------|
| `AUTH_TOKEN_MISSING` | 401 | Authorization header required | No |
| `AUTH_TOKEN_INVALID` | 401 | Token is malformed or expired | No |
| `AUTH_TOKEN_EXPIRED` | 401 | Token has expired | No (refresh) |
| `AUTH_INSUFFICIENT_PERMISSIONS` | 403 | User lacks required permission | No |
| `AUTH_TENANT_MISMATCH` | 403 | Resource belongs to different tenant | No |

#### Validation Errors (400)

| Code | HTTP | Message | Retry? |
|------|------|---------|--------|
| `VALIDATION_REQUIRED_FIELD` | 400 | Required field missing: {field} | No |
| `VALIDATION_INVALID_FORMAT` | 400 | Invalid format for field: {field} | No |
| `VALIDATION_INVALID_ENUM` | 400 | Invalid value for enum field: {field} | No |
| `VALIDATION_BODY_PARSE_ERROR` | 400 | Request body is not valid JSON | No |
| `IDEMPOTENCY_KEY_MISSING` | 400 | Idempotency-Key header required | No |
| `IDEMPOTENCY_KEY_CONFLICT` | 422 | Key already used with different payload | No |

#### Job Errors (400, 404, 409)

| Code | HTTP | Message | Retry? | FSM Mapping |
|------|------|---------|--------|-------------|
| `JOB_NOT_FOUND` | 404 | Job not found | No | - |
| `JOB_ALREADY_EXISTS` | 409 | Job with this reference already exists | No | - |
| `JOB_INVALID_STATE_TRANSITION` | 409 | Cannot {action} job in {state} state | No | - |
| `JOB_ALREADY_COMPLETED` | 409 | Job already completed | No | COMPLETED |
| `JOB_ALREADY_FAILED` | 409 | Job permanently failed | No | FAILED_TERMINAL |
| `JOB_CANCEL_NOT_ALLOWED` | 409 | Cannot cancel job in {state} state | No | - |
| `JOB_RETRY_EXHAUSTED` | 409 | Max retries exceeded | No | FAILED_TERMINAL |
| `JOB_QUOTA_EXCEEDED` | 429 | Tenant job quota exceeded | Yes (backoff) | - |

#### HITL Errors (400, 404, 409)

| Code | HTTP | Message | Retry? |
|------|------|---------|--------|
| `HITL_TASK_NOT_FOUND` | 404 | HITL task not found | No |
| `HITL_TASK_ALREADY_RESOLVED` | 409 | Task already resolved | No |
| `HITL_TASK_EXPIRED` | 410 | Task has expired | No |
| `HITL_INVALID_RESOLUTION` | 400 | Invalid resolution data | No |

#### Evidence Errors (404, 410)

| Code | HTTP | Message | Retry? |
|------|------|---------|--------|
| `EVIDENCE_NOT_FOUND` | 404 | Evidence pack not found | No |
| `EVIDENCE_NOT_SEALED` | 409 | Evidence pack not yet sealed | Yes (wait) |
| `EVIDENCE_REVOKED` | 410 | Evidence pack has been revoked | No |
| `EVIDENCE_DOWNLOAD_EXPIRED` | 410 | Download URL has expired | Yes (new URL) |
| `EVIDENCE_DOWNLOAD_QUOTA_EXCEEDED` | 429 | Daily download limit exceeded | Yes (Retry-After) |

#### Rate Limiting Errors (429)

| Code | HTTP | Message | Retry? |
|------|------|---------|--------|
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit exceeded | Yes (Retry-After) |
| `RATE_CONCURRENT_LIMIT` | 429 | Too many concurrent requests | Yes (Retry-After) |

#### System Errors (500, 503)

| Code | HTTP | Message | Retry? |
|------|------|---------|--------|
| `SYSTEM_INTERNAL_ERROR` | 500 | Internal server error | Yes (backoff) |
| `SYSTEM_DATABASE_ERROR` | 503 | Database temporarily unavailable | Yes (backoff) |
| `SYSTEM_MAINTENANCE` | 503 | System under maintenance | Yes (Retry-After) |
| `SYSTEM_INCIDENT_MODE` | 503 | System in incident mode | Yes (Retry-After) |

### 5.3 Error Response with Retry Guidance

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded for endpoint POST /jobs",
    "details": {
      "limit": 100,
      "window": "60s",
      "current": 105
    },
    "retry_after": 45,
    "retry_strategy": "exponential_backoff"
  },
  "meta": {
    "request_id": "req-uuid",
    "timestamp": "2026-01-25T10:30:00Z"
  }
}
```

---

## 6. Job Lifecycle Endpoints

### 6.0 State Transition Matrix (API-Level)

> **Scope:** [MVP REQUIRED]

Every write endpoint that modifies job state has **explicit allowed transitions**. Attempts to transition from disallowed states return `409 JOB_INVALID_STATE_TRANSITION`.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    API STATE TRANSITION MATRIX                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Current State        │ cancel │ pause │ resume │ retry │ force_retry │         │
│  ─────────────────────┼────────┼───────┼────────┼───────┼─────────────┼─────────│
│  DRAFTED              │   ✅   │  ❌   │   ❌   │  ❌   │     ❌      │         │
│  QUEUED               │   ✅   │  ✅   │   ❌   │  ❌   │     ❌      │         │
│  LOGIN_PROCESS        │   ❌   │  ✅   │   ❌   │  ❌   │     ❌      │         │
│  LOGGED_IN            │   ❌   │  ✅   │   ❌   │  ❌   │     ❌      │         │
│  FORM_FILLING         │   ❌   │  ✅   │   ❌   │  ❌   │     ❌      │         │
│  PAUSED               │   ✅   │  ❌   │   ✅   │  ✅   │     ✅      │         │
│  WAITING_HITL         │   ❌   │  ❌   │   ❌   │  ❌   │     ❌      │         │
│  PROCESSING           │   ❌   │  ❌   │   ❌   │  ❌   │     ❌      │         │
│  COMPLETED            │   ❌   │  ❌   │   ❌   │  ❌   │     ❌      │         │
│  FAILED_RETRYABLE     │   ✅   │  ❌   │   ❌   │  ✅   │     ✅      │         │
│  FAILED_TERMINAL      │   ❌   │  ❌   │   ❌   │  ❌   │     ✅      │ admin   │
│                                                                                  │
│  Legend:                                                                         │
│  ✅ = Allowed    ❌ = Blocked (returns 409)    admin = Requires admin role       │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Transition Rules per Endpoint:**

| Endpoint | From States | To State | Notes |
|----------|-------------|----------|-------|
| `POST /jobs` | (new) | `DRAFTED` or `QUEUED` | `auto_submit: true` → QUEUED |
| `POST /jobs/:id/submit` | `DRAFTED` | `QUEUED` | Validates required fields |
| `POST /jobs/:id/cancel` | `DRAFTED`, `QUEUED`, `PAUSED`, `FAILED_RETRYABLE` | `FAILED_TERMINAL` | Sets `cancellation_reason` |
| `POST /jobs/:id/pause` | `QUEUED`, `LOGIN_*`, `FORM_FILLING` | `PAUSED` | Worker checkpoints then pauses |
| `POST /jobs/:id/resume` | `PAUSED` | `QUEUED` | Resumes from checkpoint |
| `POST /jobs/:id/retry` | `PAUSED`, `FAILED_RETRYABLE` | `QUEUED` | Increments `retry_count` |
| `POST /jobs/:id/retry?force=true` | `FAILED_TERMINAL` | `QUEUED` | Admin only, resets retry count |

**HITL Transition Rules:**

| Endpoint | From States | To State | Notes |
|----------|-------------|----------|-------|
| `POST /hitl/:id/resolve` | Job in `WAITING_HITL` | Previous processing state | Worker receives resolution |
| `POST /hitl/:id/escalate` | Job in `WAITING_HITL` | `WAITING_HITL` | Task reassigned, SLA extended |
| (SLA expiry) | Job in `WAITING_HITL` | `FAILED_RETRYABLE` | Automatic, no API call |

**Evidence Pack Transition Rules:**

| Endpoint | Preconditions | Effect |
|----------|---------------|--------|
| `GET /evidence/:jobId` | `job.status = COMPLETED` | Returns metadata |
| `GET /evidence/:jobId/download-url` | `evidence_pack.status = SEALED` | Returns presigned URL |
| `POST /evidence/:jobId/verify` | `evidence_pack.status = SEALED` | Validates hash/signature |

**Special: NEEDS_REAUTH Handling**

When a worker detects session expiry on the target site:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  NEEDS_REAUTH FLOW (Internal, not API-triggered)                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Worker detects: "Session expired" or "Please login again"                       │
│       │                                                                          │
│       ▼                                                                          │
│  Worker emits: NEEDS_REAUTH event                                                │
│       │                                                                          │
│       ▼                                                                          │
│  Worker saves checkpoint (current progress)                                      │
│       │                                                                          │
│       ▼                                                                          │
│  Job transitions: current_state → LOGIN_PROCESS                                  │
│       │                                                                          │
│       ▼                                                                          │
│  Worker attempts re-authentication with:                                         │
│  • Same proxy session (proxy_session_id from metadata)                           │
│  • Same credentials                                                              │
│       │                                                                          │
│       ├── Success → Resume from checkpoint                                       │
│       └── Failure → HITL or FAILED_RETRYABLE                                     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### 6.1 Create Job

**Endpoint:** `POST /jobs`

**Request:**
```json
{
  "reference": "client-ref-123",
  "visa_type": "business",
  "priority": 5,
  "applicant": {
    "full_name": "John Doe",
    "passport_number": "AB123456",
    "nationality": "US",
    "date_of_birth": "1985-06-15"
  },
  "travel": {
    "destination_country": "DE",
    "entry_date": "2026-03-01",
    "exit_date": "2026-03-15",
    "purpose": "business_meeting"
  },
  "documents": [
    {
      "type": "passport_scan",
      "storage_ref": "s3://uploads/tenant-uuid/passport.pdf"
    }
  ],
  "webhook_url": "https://customer.example.com/webhooks/visa",
  "metadata": {
    "internal_ref": "EMP-001"
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "job-uuid",
    "reference": "client-ref-123",
    "status": "QUEUED",
    "priority": 5,
    "created_at": "2026-01-25T10:30:00Z",
    "estimated_completion": "2026-01-25T14:00:00Z"
  },
  "meta": {
    "request_id": "req-uuid",
    "timestamp": "2026-01-25T10:30:00Z"
  }
}
```

### 6.2 Get Job

**Endpoint:** `GET /jobs/:id`

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "job-uuid",
    "reference": "client-ref-123",
    "status": "FORM_FILLING",
    "status_detail": "Filling travel details section",
    "priority": 5,
    "progress": {
      "current_step": "travel_details",
      "total_steps": 5,
      "completed_steps": 2,
      "percentage": 40
    },
    "retry_count": 0,
    "max_retries": 3,
    "created_at": "2026-01-25T10:30:00Z",
    "updated_at": "2026-01-25T11:15:00Z",
    "billing": {
      "status": "NOT_ELIGIBLE",
      "billable_outcome": null
    }
  }
}
```

### 6.3 List Jobs

**Endpoint:** `GET /jobs`

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status (comma-separated) |
| `created_after` | ISO 8601 | Jobs created after timestamp |
| `created_before` | ISO 8601 | Jobs created before timestamp |
| `reference` | string | Filter by client reference |
| `limit` | integer | Page size (default: 50, max: 100) |
| `cursor` | string | Pagination cursor |

**Example:**
```
GET /jobs?status=QUEUED,PROCESSING&created_after=2026-01-01T00:00:00Z&limit=25
```

### 6.4 Cancel Job

**Endpoint:** `POST /jobs/:id/cancel`

**Request:**
```json
{
  "reason": "Customer requested cancellation"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "job-uuid",
    "status": "FAILED_TERMINAL",
    "cancelled_at": "2026-01-25T12:00:00Z",
    "cancellation_reason": "Customer requested cancellation"
  }
}
```

**Allowed States:** `DRAFTED`, `QUEUED`, `PAUSED`  
**Error:** `JOB_CANCEL_NOT_ALLOWED` if job is in progress

### 6.5 Retry Job

**Endpoint:** `POST /jobs/:id/retry`

**Request:**
```json
{
  "force": false,
  "reset_state": false
}
```

| Field | Type | Description |
|-------|------|-------------|
| `force` | boolean | Retry even if max retries exceeded (admin only) |
| `reset_state` | boolean | Reset to QUEUED instead of resume from checkpoint |

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "job-uuid",
    "status": "QUEUED",
    "retry_count": 2,
    "queued_at": "2026-01-25T12:00:00Z"
  }
}
```

**Allowed States:** `FAILED_RETRYABLE`, `PAUSED`  
**Error:** `JOB_RETRY_EXHAUSTED` if max retries exceeded and `force=false`

### 6.6 Pause Job

**Endpoint:** `POST /jobs/:id/pause`

**Request:**
```json
{
  "reason": "Manual hold for document verification"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "job-uuid",
    "status": "PAUSED",
    "paused_at": "2026-01-25T12:00:00Z",
    "pause_reason": "Manual hold for document verification"
  }
}
```

**Allowed States:** `QUEUED`, `LOGIN_PROCESS`, `LOGGED_IN`, `FORM_FILLING`  
**Note:** Worker will checkpoint and pause at next safe point

### 6.7 Resume Job

**Endpoint:** `POST /jobs/:id/resume`

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "job-uuid",
    "status": "QUEUED",
    "resumed_at": "2026-01-25T12:00:00Z"
  }
}
```

**Allowed States:** `PAUSED`

---

## 7. HITL Endpoints

### 7.1 List HITL Tasks

> **Scope:** [MVP REQUIRED]

**Endpoint:** `GET /hitl/tasks`

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | `PENDING`, `IN_PROGRESS`, `RESOLVED`, `EXPIRED` |
| `task_type` | string | `captcha`, `document_upload`, `manual_verification` |
| `priority` | string | `low`, `medium`, `high`, `critical` |
| `limit` | integer | Page size |
| `cursor` | string | Pagination cursor |

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "hitl-task-uuid",
        "job_id": "job-uuid",
        "task_type": "captcha",
        "status": "PENDING",
        "priority": "high",
        "context": {
          "screenshot_url": "https://...",
          "html_snapshot_url": "https://...",
          "instructions": "Please solve the CAPTCHA shown"
        },
        "sla": {
          "expires_at": "2026-01-25T12:30:00Z",
          "remaining_seconds": 1800
        },
        "created_at": "2026-01-25T12:00:00Z"
      }
    ],
    "pagination": {
      "has_more": true,
      "next_cursor": "..."
    }
  }
}
```

### 7.2 Get HITL Task

**Endpoint:** `GET /hitl/tasks/:id`

**Response includes full context pack:**
```json
{
  "success": true,
  "data": {
    "id": "hitl-task-uuid",
    "job_id": "job-uuid",
    "task_type": "captcha",
    "status": "PENDING",
    "context": {
      "screenshot_url": "https://presigned-url...",
      "screenshot_expires_at": "2026-01-25T12:15:00Z",
      "html_snapshot_url": "https://presigned-url...",
      "current_state": {
        "checkpoint": "LOGIN_PAGE",
        "form_data": {}
      },
      "instructions": "Please solve the CAPTCHA shown in the screenshot",
      "expected_response_format": {
        "type": "text",
        "field": "captcha_solution"
      }
    },
    "history": [
      {
        "action": "created",
        "timestamp": "2026-01-25T12:00:00Z"
      }
    ]
  }
}
```

### 7.3 Resolve HITL Task

**Endpoint:** `POST /hitl/tasks/:id/resolve`

**Request:**
```json
{
  "resolution": {
    "captcha_solution": "ABC123"
  },
  "notes": "Solved manually"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "hitl-task-uuid",
    "status": "RESOLVED",
    "resolved_at": "2026-01-25T12:05:00Z",
    "resolved_by": "user-uuid",
    "job_status": "LOGIN_PROCESS"
  }
}
```

**Errors:**
- `HITL_TASK_ALREADY_RESOLVED` if task already resolved
- `HITL_TASK_EXPIRED` if SLA expired
- `HITL_INVALID_RESOLUTION` if resolution data doesn't match expected format

### 7.4 Skip/Escalate HITL Task

**Endpoint:** `POST /hitl/tasks/:id/escalate`

**Request:**
```json
{
  "reason": "Unable to solve CAPTCHA, appears to be broken",
  "escalate_to": "admin"
}
```

---

## 8. Evidence Pack Endpoints



### Evidence Modes

- **Mode A (MVP / Light Evidence)**: store appointment reference + date/time (+ optional screenshot). No sealing, no manifests, no signatures.
- **Mode B (Later / Sealed Evidence Pack)**: full evidence pack with manifest hash, signature/HMAC, verify endpoint, and presigned download URLs.

> For v1 pilot, implement **Mode A** only. Keep Mode B endpoints as stubs or return `501 NOT_IMPLEMENTED` until Phase enables them.
### 8.1 Get Evidence Pack Metadata

> **Scope:** [PHASED / LATER]

**Endpoint:** `GET /evidence/:job_id`

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "job_id": "job-uuid",
    "status": "SEALED",
    "sealed_at": "2026-01-25T14:00:00Z",
    "contents": {
      "has_screenshot": true,
      "has_html_snapshot": true,
      "has_fsm_timeline": true,
      "has_hitl_records": true
    },
    "integrity": {
      "manifest_hash": "sha256:abc123...",
      "signing_method": "HMAC-SHA256",
      "signed": true
    },
    "outcome": {
      "status": "COMPLETED",
      "confirmation_number": "VISA-2026-ABC123"
    }
  }
}
```

### 8.2 Get Evidence Pack Download URL

**Endpoint:** `GET /evidence/:job_id/download-url`

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `expires_in` | integer | URL validity in seconds (default: 3600, max: 86400) |

**Download Quota & Rate Limiting:**

To control egress costs, downloads are rate-limited per job and per tenant:

| Scope | Limit | Window | Rationale |
|-------|-------|--------|-----------|
| Per job | 10 downloads | 24 hours | Prevent abuse on single job |
| Per tenant | 100 downloads | 24 hours | Control overall egress costs |

When limit is exceeded, the endpoint returns `429 Too Many Requests`:

```json
{
  "success": false,
  "error": {
    "code": "EVIDENCE_DOWNLOAD_QUOTA_EXCEEDED",
    "message": "Daily download limit exceeded for this job",
    "details": {
      "limit": 10,
      "used": 10,
      "resets_at": "2026-01-26T00:00:00Z"
    },
    "retry_after": 3600
  }
}
```

**Cache-Control Headers:**

Pre-signed URLs include cache headers to encourage client-side caching:

```
Cache-Control: private, max-age=3600
X-Evidence-Pack-Hash: sha256:abc123...
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "download_url": "https://s3.amazonaws.com/...",
    "expires_at": "2026-01-25T15:00:00Z",
    "file_size_bytes": 1234567,
    "content_type": "application/zip",
    "quota": {
      "remaining_job": 9,
      "remaining_tenant": 95,
      "resets_at": "2026-01-26T00:00:00Z"
    }
  }
}
```

**Audit Log Entry:**
```json
{
  "action": "evidence_download_url_generated",
  "job_id": "job-uuid",
  "user_id": "user-uuid",
  "tenant_id": "tenant-uuid",
  "ip_address": "192.168.1.1",
  "timestamp": "2026-01-25T14:00:00Z",
  "quota_remaining": 9
}
```

### 8.3 Verify Evidence Pack

**Endpoint:** `POST /evidence/:job_id/verify`

**Request:**
```json
{
  "manifest_hash": "sha256:abc123..."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "valid": true,
    "checks": {
      "manifest_hash_match": true,
      "signature_valid": true,
      "seal_event_exists": true,
      "not_revoked": true
    },
    "verified_at": "2026-01-25T14:05:00Z"
  }
}
```

---

## 9. Admin Operations Endpoints

> **Authorization:** Requires `admin` role or `system` service account

> **Scope:** [MVP REQUIRED]

### 9.1 Set Incident Mode

**Endpoint:** `POST /admin/incident-mode`

**Request:**
```json
{
  "mode": "PAUSE_ALL",
  "reason": "Database maintenance",
  "estimated_duration_minutes": 30,
  "notify_customers": true
}
```

**Modes:**

| Mode | Description |
|------|-------------|
| `NORMAL` | Normal operation |
| `PAUSE_ALL` | Pause all new job processing |
| `DRAIN_ONLY` | Complete in-progress jobs, no new jobs |
| `MAINTENANCE` | Full maintenance mode |

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "previous_mode": "NORMAL",
    "current_mode": "PAUSE_ALL",
    "activated_at": "2026-01-25T14:00:00Z",
    "activated_by": "admin-user-uuid",
    "jobs_paused": 15,
    "jobs_in_progress": 3
  }
}
```

### 9.2 Worker Drain

**Endpoint:** `POST /admin/worker/drain`

**Request:**
```json
{
  "worker_id": "worker-uuid",
  "reason": "Scheduled maintenance",
  "grace_period_seconds": 300
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "worker_id": "worker-uuid",
    "status": "DRAINING",
    "current_jobs": 2,
    "drain_started_at": "2026-01-25T14:00:00Z",
    "expected_drain_completion": "2026-01-25T14:10:00Z"
  }
}
```

### 9.3 Get System Health

**Endpoint:** `GET /admin/health`

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "mode": "NORMAL",
    "components": {
      "database": { "status": "healthy", "latency_ms": 5 },
      "redis": { "status": "healthy", "latency_ms": 2 },
      "workers": { "status": "healthy", "active": 4, "total": 4 },
      "queue": { "status": "healthy", "depth": 25, "oldest_job_age_seconds": 120 }
    },
    "metrics": {
      "jobs_completed_24h": 1234,
      "jobs_failed_24h": 12,
      "avg_completion_time_minutes": 45
    }
  }
}
```


### 9.4 Portal Policies (Scheduling & Limits)

These endpoints allow tenant admins to control **how many agents run per portal** and whether processing is **serial** or **parallel**.

**Policy Fields (per portal):**
- `mode`: `SERIAL` | `PARALLEL`
- `max_concurrency`: integer (e.g., 1 for serial)
- `enabled`: boolean
- (optional) `request_budget`: `{ rpm: number, rph: number }`
- (optional) `circuit_breaker`: `{ consecutive_403: number, rate_429_pct: number, window_seconds: number }`

**Endpoints:**
- `GET /admin/portal-policies`
- `PUT /admin/portal-policies/:portal_id`

**Request (PUT):**
```json
{
  "mode": "PARALLEL",
  "max_concurrency": 5,
  "enabled": true
}
```

### 9.5 Agent Fleet Management

Agents (workers) can be assigned to specific portals so that admins can control which agent runs where.

**Endpoints:**
- `GET /admin/agents`
- `PATCH /admin/agents/:id`

**Request (PATCH):**
```json
{
  "enabled": true,
  "assigned_portal_ids": ["idata-ita", "as-visa-ankara"]
}
```

**Notes:**
- If a portal policy is `SERIAL`, effective concurrency is **1**, even if multiple agents are assigned.
- Agents must only pull jobs for portals in `assigned_portal_ids`.


### 9.4 Force Job State Transition (Emergency)

**Endpoint:** `POST /admin/jobs/:id/force-transition`

**Request:**
```json
{
  "target_state": "FAILED_TERMINAL",
  "reason": "Manual intervention required - stuck in invalid state",
  "bypass_fsm_rules": true
}
```

> **Warning:** This endpoint bypasses normal FSM validation. Use only in emergencies.

---

## 10. Webhook Delivery Contract



### Webhook Usage Notes (Internal Ops First)

Webhooks can be used for:
- Internal notifications (ops alerts)
- Canary jobs / portal-change detection signals
- Integrations with internal schedulers (cron/automation)

Customer-facing webhooks are **optional** and should be enabled only when a customer portal is introduced.
### 10.1 Webhook Events

> **Scope:** [PHASED / LATER]

| Event | Trigger | Payload |
|-------|---------|---------|
| `job.created` | Job created | Job summary |
| `job.status_changed` | Any status transition | Old/new status, timestamp |
| `job.completed` | Job reached COMPLETED | Full job data + evidence URL |
| `job.failed` | Job reached FAILED_TERMINAL | Error details |
| `hitl.required` | HITL task created | Task summary |
| `hitl.resolved` | HITL task resolved | Resolution details |
| `evidence.sealed` | Evidence pack sealed | Pack metadata |
| `billing.eligible` | Job became billable | Billing details |
| `portal.change_detected` | Canary detects portal DOM/template change | Portal id + diff summary + severity |

### 10.2 Webhook Payload Structure


**Example: portal.change_detected**
```json
{
  "id": "webhook-event-uuid",
  "type": "portal.change_detected",
  "created_at": "2026-01-25T14:00:00Z",
  "tenant_id": "tenant-uuid",
  "data": {
    "portal_id": "idata-ita",
    "severity": "high",
    "diff_summary": "Login form selectors changed; submit button id replaced",
    "canary_job_id": "job-uuid",
    "detected_at": "2026-01-25T13:59:20Z"
  }
}
```

```json
{
  "id": "webhook-event-uuid",
  "type": "job.completed",
  "created_at": "2026-01-25T14:00:00Z",
  "tenant_id": "tenant-uuid",
  "data": {
    "job_id": "job-uuid",
    "reference": "client-ref-123",
    "status": "COMPLETED",
    "confirmation_number": "VISA-2026-ABC123",
    "evidence_pack_url": "https://api.../evidence/job-uuid/download-url",
    "billable": true
  }
}
```

### 10.3 Webhook Signature Verification

```
X-Webhook-Signature: sha256=abc123...
X-Webhook-Timestamp: 1706191200
```

**Verification:**
```
expected = HMAC-SHA256(
  key: webhook_secret,
  message: timestamp + "." + raw_body
)
valid = timing_safe_compare(expected, signature)
```

### 10.4 Retry Policy

| Attempt | Delay | Total Time |
|---------|-------|------------|
| 1 | Immediate | 0 |
| 2 | 30 seconds | 30s |
| 3 | 2 minutes | 2m 30s |
| 4 | 10 minutes | 12m 30s |
| 5 | 1 hour | 1h 12m 30s |
| Dead Letter | - | Stored for manual retry |

**Success:** HTTP 2xx response  
**Retry:** HTTP 4xx (except 410), 5xx, timeout, connection error  
**Fail:** HTTP 410 Gone (permanently disable webhook)
