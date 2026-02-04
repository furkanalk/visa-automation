## Scope Labels

This document defines **authentication, authorization, and system security model**.

- **[MVP REQUIRED]** → mandatory for production security
- **[OPS]** → operational practices & monitoring
- **[PHASED / LATER]** → optional enhancements

This is a security‑critical document. Do not remove RBAC, isolation, or token rules.

---

# Security Model Specification

## Authentication, Authorization, Tenant Isolation & Audit

> **Document Status:** Locked Specification  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [API Contract](../api/VISA_CORE_API_CONTRACT.md) | [Architecture](../architecture/VISA_SAAS_ARCHITECTURE.md) | [Data Protection](../security/VISA_DATA_PROTECTION.md)

---

## Table of Contents

1. [Security Principles](#1-security-principles)
2. [Authentication (AuthN)](#2-authentication-authn)
3. [Authorization (AuthZ)](#3-authorization-authz)
4. [Tenant Isolation](#4-tenant-isolation)
5. [Audit Logging](#5-audit-logging)
6. [Session Management](#6-session-management)
7. [API Security](#7-api-security)
8. [Infrastructure Security](#8-infrastructure-security)

---

## 1. Security Principles

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          SECURITY DESIGN PRINCIPLES                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  1. DEFENSE IN DEPTH                                                             │
│     Multiple security layers: network, application, data.                        │
│     No single point of failure for security.                                     │
│                                                                                  │
│  2. LEAST PRIVILEGE                                                              │
│     Every component gets minimum permissions required.                           │
│     Default deny, explicit allow.                                                │
│                                                                                  │
│  3. TENANT ISOLATION BY DEFAULT                                                  │
│     All data access is tenant-scoped.                                            │
│     Cross-tenant access is architecturally impossible.                           │
│                                                                                  │
│  4. ZERO TRUST INTERNAL                                                          │
│     Services authenticate to each other.                                         │
│     No implicit trust based on network location.                                 │
│                                                                                  │
│  5. AUDIT EVERYTHING                                                             │
│     All security-relevant actions are logged.                                    │
│     Logs are immutable and retained per compliance.                              │
│                                                                                  │
│  6. FAIL SECURE                                                                  │
│     On error, default to deny access.                                            │
│     Never expose sensitive data in error messages.                               │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Authentication (AuthN)

### 2.1 Authentication Methods

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION METHODS                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  METHOD 1: JWT BEARER TOKEN (Primary)                                   │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Use Case:    User sessions, portal access                              │    │
│  │  Header:      Authorization: Bearer <jwt>                               │    │
│  │  Lifetime:    Access: 1 hour | Refresh: 7 days                          │    │
│  │  Validation:  Signature + expiry + claims                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  METHOD 2: API KEY (Server-to-Server)                                   │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Use Case:    Backend integrations, automation                          │    │
│  │  Header:      X-API-Key: <key>                                          │    │
│  │  Lifetime:    Long-lived (rotatable)                                    │    │
│  │  Validation:  Hash lookup + tenant association                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  METHOD 3: SERVICE TOKEN (Internal)                                     │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Use Case:    Worker → API, internal service calls                      │    │
│  │  Header:      Authorization: Bearer <service-jwt>                       │    │
│  │  Lifetime:    Short (15 minutes, auto-refresh)                          │    │
│  │  Validation:  Signature + service identity claim                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 JWT Token Structure

**Access Token Claims:**

```json
{
  "sub": "user-uuid",
  "tenant_id": "tenant-uuid",
  "email": "user@example.com",
  "roles": ["operator"],
  "permissions": [
    "job:create",
    "job:read",
    "job:cancel",
    "hitl:read",
    "hitl:resolve",
    "evidence:read"
  ],
  "session_id": "session-uuid",
  "iat": 1706185200,
  "exp": 1706188800,
  "iss": "visa-automation",
  "aud": "visa-automation-api"
}
```

**Service Token Claims:**

```json
{
  "sub": "service:worker-01",
  "service_type": "worker",
  "permissions": ["internal:*"],
  "iat": 1706185200,
  "exp": 1706186100,
  "iss": "visa-automation",
  "aud": "visa-automation-internal"
}
```

### 2.3 Token Validation Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          TOKEN VALIDATION FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Request arrives at Kong Gateway                                                 │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. EXTRACT TOKEN                                                       │    │
│  │     • Check Authorization header (Bearer)                               │    │
│  │     • Check X-API-Key header                                            │    │
│  │     • Missing → 401 AUTH_TOKEN_MISSING                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  2. VALIDATE TOKEN                                                      │    │
│  │     JWT:                                                                │    │
│  │     • Verify signature (RS256 with public key)                          │    │
│  │     • Check expiry (exp claim)                                          │    │
│  │     • Verify issuer (iss claim)                                         │    │
│  │     • Verify audience (aud claim)                                       │    │
│  │     API Key:                                                            │    │
│  │     • Hash and lookup in database                                       │    │
│  │     • Check key is active                                               │    │
│  │     Invalid → 401 AUTH_TOKEN_INVALID                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  3. EXTRACT IDENTITY                                                    │    │
│  │     • user_id (sub claim)                                               │    │
│  │     • tenant_id (from token or API key association)                     │    │
│  │     • roles and permissions                                             │    │
│  │     • session_id (for audit)                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  4. ATTACH TO REQUEST CONTEXT                                           │    │
│  │     • Set X-Tenant-ID header                                            │    │
│  │     • Set X-User-ID header                                              │    │
│  │     • Set X-Permissions header (JSON array)                             │    │
│  │     • Forward to upstream service                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 API Key Management

```sql
CREATE TABLE api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  key_hash      TEXT NOT NULL UNIQUE,        -- SHA-256 hash of key
  key_prefix    TEXT NOT NULL,               -- First 8 chars for identification
  name          TEXT NOT NULL,               -- Human-readable name
  permissions   TEXT[] NOT NULL,             -- Allowed permissions
  created_by    UUID NOT NULL,               -- User who created the key
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,                 -- NULL = no expiry
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID
);

CREATE INDEX idx_api_keys_tenant ON api_keys (tenant_id);
CREATE INDEX idx_api_keys_hash ON api_keys (key_hash) WHERE revoked_at IS NULL;
```

**Key Format:** `vak_live_` + 32 random bytes (base64url)  
**Example:** `vak_live_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456`

---

## 3. Authorization (AuthZ)

### 3.1 RBAC Role Definitions

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              RBAC ROLES                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  ADMIN (Tenant Administrator)                                           │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  • Full access to all tenant resources                                  │    │
│  │  • User management (invite, remove, role assignment)                    │    │
│  │  • API key management (create, revoke)                                  │    │
│  │  • Billing settings and invoice access                                  │    │
│  │  • Webhook configuration                                                │    │
│  │  • Cannot access other tenants or system admin functions                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  OPERATOR (Day-to-Day Operations)                                       │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  • Create, view, cancel, retry jobs                                     │    │
│  │  • View and resolve HITL tasks                                          │    │
│  │  • View evidence packs                                                  │    │
│  │  • View (not modify) billing information                                │    │
│  │  • Cannot manage users or API keys                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  VIEWER (Read-Only Access)                                              │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  • View jobs and their status                                           │    │
│  │  • View HITL tasks (no resolution)                                      │    │
│  │  • View evidence packs                                                  │    │
│  │  • View billing history                                                 │    │
│  │  • Cannot create, modify, or delete anything                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  SYSTEM (Internal Services)                                             │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  • Full API access for automation                                       │    │
│  │  • Admin operations (incident mode, worker management)                  │    │
│  │  • Cross-tenant access for system maintenance                           │    │
│  │  • Only granted to internal service accounts                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Permission Definitions

| Permission | Description | Roles |
|------------|-------------|-------|
| `job:create` | Create new jobs | admin, operator |
| `job:read` | View job list and details | admin, operator, viewer |
| `job:cancel` | Cancel jobs | admin, operator |
| `job:retry` | Retry failed jobs | admin, operator |
| `job:pause` | Pause/resume jobs | admin, operator |
| `hitl:read` | View HITL tasks | admin, operator, viewer |
| `hitl:resolve` | Resolve HITL tasks | admin, operator |
| `hitl:escalate` | Escalate HITL tasks | admin, operator |
| `evidence:read` | View evidence packs | admin, operator, viewer |
| `evidence:download` | Download evidence packs | admin, operator, viewer |
| `billing:read` | View billing info | admin, operator, viewer |
| `billing:manage` | Manage billing settings | admin |
| `user:read` | View users | admin |
| `user:manage` | Manage users | admin |
| `apikey:manage` | Manage API keys | admin |
| `webhook:manage` | Manage webhooks | admin |
| `admin:incident` | Set incident mode | system |
| `admin:worker` | Manage workers | system |

### 3.3 Authorization Middleware

```typescript
// Authorization middleware pseudocode
function authorize(requiredPermission: string) {
  return async (req, res, next) => {
    const userPermissions = req.context.permissions;
    
    // Check permission
    if (!userPermissions.includes(requiredPermission) && 
        !userPermissions.includes('*')) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'AUTH_INSUFFICIENT_PERMISSIONS',
          message: `Permission '${requiredPermission}' required`,
          details: { required: requiredPermission }
        }
      });
    }
    
    next();
  };
}

// Usage
app.post('/jobs', 
  authenticate,
  authorize('job:create'),
  tenantIsolation,
  createJobHandler
);
```

---

## 4. Tenant Isolation

### 4.1 Isolation Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        TENANT ISOLATION ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  LAYER 1: API GATEWAY (Kong)                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Extract tenant_id from token                                         │    │
│  │  • Inject X-Tenant-ID header                                            │    │
│  │  • Rate limit per tenant                                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  LAYER 2: APPLICATION MIDDLEWARE                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Validate X-Tenant-ID header                                          │    │
│  │  • Set tenant context for request                                       │    │
│  │  • Automatic query filtering                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  LAYER 3: DATABASE (Row-Level Security)                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • All tables have tenant_id column                                     │    │
│  │  • Application sets current_setting('app.tenant_id')                    │    │
│  │  • RLS policies filter by tenant_id                                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  LAYER 4: OBJECT STORAGE                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Path prefix: s3://bucket/{tenant_id}/...                             │    │
│  │  • Presigned URLs scoped to tenant path                                 │    │
│  │  • IAM policies prevent cross-tenant access                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Tenant Isolation Middleware

```typescript
// Tenant isolation middleware
async function tenantIsolation(req, res, next) {
  const tenantId = req.context.tenant_id;
  
  if (!tenantId) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'AUTH_TENANT_MISSING',
        message: 'Tenant context required'
      }
    });
  }
  
  // Verify tenant exists and is active
  const tenant = await db.tenants.findOne({ 
    id: tenantId, 
    status: 'active' 
  });
  
  if (!tenant) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'AUTH_TENANT_INVALID',
        message: 'Tenant not found or inactive'
      }
    });
  }
  
  // Set tenant context for database queries
  await db.raw(`SET LOCAL app.tenant_id = '${tenantId}'`);
  
  // Attach tenant to request
  req.tenant = tenant;
  
  next();
}
```

### 4.3 Database Row-Level Security

```sql
-- Enable RLS on tenant-scoped tables
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitl_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_packs ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for jobs
CREATE POLICY tenant_isolation_jobs ON jobs
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Create RLS policy for job_runs (through jobs)
CREATE POLICY tenant_isolation_job_runs ON job_runs
  USING (
    job_id IN (
      SELECT id FROM jobs 
      WHERE tenant_id = current_setting('app.tenant_id')::UUID
    )
  );

-- Create RLS policy for hitl_tasks
CREATE POLICY tenant_isolation_hitl ON hitl_tasks
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Create RLS policy for evidence_packs
CREATE POLICY tenant_isolation_evidence ON evidence_packs
  USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Bypass policy for system operations (admin role)
CREATE POLICY system_bypass_jobs ON jobs
  TO system_role
  USING (true);
```

### 4.4 Resource Ownership Verification

```typescript
// Verify resource belongs to tenant before access
async function verifyResourceOwnership(
  resourceType: 'job' | 'hitl_task' | 'evidence_pack',
  resourceId: string,
  tenantId: string
): Promise<boolean> {
  const query = {
    job: 'SELECT 1 FROM jobs WHERE id = $1 AND tenant_id = $2',
    hitl_task: 'SELECT 1 FROM hitl_tasks WHERE id = $1 AND tenant_id = $2',
    evidence_pack: 'SELECT 1 FROM evidence_packs WHERE id = $1 AND tenant_id = $2'
  };
  
  const result = await db.query(query[resourceType], [resourceId, tenantId]);
  
  if (!result.rows.length) {
    throw new ForbiddenError({
      code: 'AUTH_TENANT_MISMATCH',
      message: `${resourceType} does not belong to this tenant`
    });
  }
  
  return true;
}
```

---

## 5. Audit Logging

### 5.1 Audit Log Schema

```sql
CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID,                         -- NULL for system actions
  user_id       UUID,                         -- NULL for service accounts
  session_id    UUID,                         -- NULL for API key access
  action        TEXT NOT NULL,                -- Action identifier
  resource_type TEXT NOT NULL,                -- job, hitl_task, user, etc.
  resource_id   UUID,                         -- ID of affected resource
  request_id    UUID NOT NULL,                -- Correlation ID
  ip_address    INET NOT NULL,
  user_agent    TEXT,
  request_method TEXT NOT NULL,               -- GET, POST, etc.
  request_path  TEXT NOT NULL,
  request_body  JSONB,                        -- Sanitized (no PII)
  response_code INTEGER NOT NULL,
  response_time_ms INTEGER NOT NULL,
  success       BOOLEAN NOT NULL,
  error_code    TEXT,                         -- If failed
  metadata      JSONB,                        -- Additional context
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partition by month for efficient queries and retention
CREATE TABLE audit_log_2026_01 PARTITION OF audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

-- Indexes for common queries
CREATE INDEX idx_audit_log_tenant_time ON audit_log (tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_user ON audit_log (user_id, created_at DESC);
CREATE INDEX idx_audit_log_resource ON audit_log (resource_type, resource_id);
CREATE INDEX idx_audit_log_action ON audit_log (action, created_at DESC);
```

### 5.2 Audited Actions

| Action | Resource Type | Description |
|--------|---------------|-------------|
| `job.created` | job | Job creation |
| `job.cancelled` | job | Job cancellation |
| `job.retried` | job | Job retry initiated |
| `job.paused` | job | Job paused |
| `job.resumed` | job | Job resumed |
| `hitl.resolved` | hitl_task | HITL task resolved |
| `hitl.escalated` | hitl_task | HITL task escalated |
| `evidence.viewed` | evidence_pack | Evidence metadata viewed |
| `evidence.downloaded` | evidence_pack | Evidence pack downloaded |
| `user.invited` | user | User invited to tenant |
| `user.removed` | user | User removed from tenant |
| `user.role_changed` | user | User role modified |
| `apikey.created` | api_key | API key created |
| `apikey.revoked` | api_key | API key revoked |
| `webhook.configured` | webhook | Webhook URL configured |
| `auth.login` | session | User logged in |
| `auth.logout` | session | User logged out |
| `auth.failed` | session | Authentication failed |
| `admin.incident_mode` | system | Incident mode changed |
| `admin.worker_drain` | worker | Worker drain initiated |

### 5.3 Audit Logging Middleware

```typescript
// Audit logging middleware
async function auditLog(req, res, next) {
  const startTime = Date.now();
  
  // Capture original end function
  const originalEnd = res.end;
  
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    
    // Log asynchronously to not block response
    setImmediate(async () => {
      await db.auditLog.insert({
        tenant_id: req.context?.tenant_id,
        user_id: req.context?.user_id,
        session_id: req.context?.session_id,
        action: determineAction(req),
        resource_type: determineResourceType(req),
        resource_id: req.params?.id,
        request_id: req.headers['x-request-id'],
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        request_method: req.method,
        request_path: req.path,
        request_body: sanitizeBody(req.body),
        response_code: res.statusCode,
        response_time_ms: responseTime,
        success: res.statusCode < 400,
        error_code: res.locals.errorCode
      });
    });
    
    return originalEnd.apply(this, args);
  };
  
  next();
}
```

### 5.4 Evidence Pack Access Audit

Evidence pack access requires additional audit detail:

```typescript
// Special audit for evidence pack downloads
async function auditEvidenceAccess(
  tenantId: string,
  userId: string,
  jobId: string,
  accessType: 'view' | 'download'
) {
  await db.auditLog.insert({
    tenant_id: tenantId,
    user_id: userId,
    action: `evidence.${accessType}`,
    resource_type: 'evidence_pack',
    resource_id: jobId,
    metadata: {
      access_type: accessType,
      job_status: await getJobStatus(jobId),
      pack_status: await getPackStatus(jobId),
      reason: 'user_request' // or 'billing_dispute', 'support_request'
    }
  });
}
```

---

## 6. Session Management

### 6.1 Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          SESSION LIFECYCLE                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  LOGIN                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. User submits credentials                                            │    │
│  │  2. Validate credentials (password hash, MFA if enabled)                │    │
│  │  3. Create session record in database                                   │    │
│  │  4. Generate access token (1h) + refresh token (7d)                     │    │
│  │  5. Audit: auth.login                                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  TOKEN REFRESH                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Client submits refresh token                                        │    │
│  │  2. Validate refresh token (not expired, not revoked)                   │    │
│  │  3. Check session still active                                          │    │
│  │  4. Generate new access token                                           │    │
│  │  5. Optionally rotate refresh token                                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  LOGOUT                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Client requests logout                                              │    │
│  │  2. Revoke session in database                                          │    │
│  │  3. Add refresh token to blocklist (Redis)                              │    │
│  │  4. Audit: auth.logout                                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  SESSION TIMEOUT                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Absolute timeout: 24 hours (configurable)                            │    │
│  │  • Idle timeout: 2 hours of inactivity                                  │    │
│  │  • Concurrent session limit: 5 per user (configurable)                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Session Storage

```sql
CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  refresh_token_hash TEXT NOT NULL,
  ip_address      INET NOT NULL,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ
);

CREATE INDEX idx_sessions_user ON user_sessions (user_id, created_at DESC);
CREATE INDEX idx_sessions_refresh ON user_sessions (refresh_token_hash) 
WHERE revoked_at IS NULL;
```

---

## 7. API Security

### 7.1 Rate Limiting

| Endpoint Category | Limit | Window | Scope |
|-------------------|-------|--------|-------|
| Authentication | 10 | 1 minute | IP |
| Job creation | 100 | 1 minute | Tenant |
| Job queries | 300 | 1 minute | Tenant |
| HITL operations | 60 | 1 minute | User |
| Evidence downloads | 30 | 1 hour | Tenant |
| Admin operations | 10 | 1 minute | User |

### 7.2 Request Validation

```typescript
// Input validation rules
const jobCreateSchema = {
  reference: { type: 'string', maxLength: 100, required: true },
  visa_type: { type: 'enum', values: ['business', 'tourist', 'transit'], required: true },
  priority: { type: 'integer', min: 0, max: 10, default: 5 },
  applicant: {
    full_name: { type: 'string', maxLength: 200, required: true },
    passport_number: { type: 'string', pattern: /^[A-Z0-9]{6,12}$/, required: true },
    // ... other fields
  }
};

// Sanitization rules
const sanitizationRules = {
  // Remove potential XSS
  strings: (value) => DOMPurify.sanitize(value),
  // Validate UUIDs
  uuids: (value) => isValidUUID(value) ? value : null,
  // Limit JSON depth
  json: (value) => JSON.parse(JSON.stringify(value, null, 0).slice(0, 10000))
};
```

### 7.3 Response Security Headers

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
```

---

## 8. Infrastructure Security

### 8.1 Network Segmentation

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          NETWORK ARCHITECTURE                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  INTERNET                                                                        │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  PUBLIC SUBNET                                                          │    │
│  │  • Kong Gateway (TLS termination)                                       │    │
│  │  • Only port 443 exposed                                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Internal network only                                                    │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  APPLICATION SUBNET                                                     │    │
│  │  • API service                                                          │    │
│  │  • Worker service                                                       │    │
│  │  • No direct internet access                                            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Internal network only                                                    │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  DATA SUBNET                                                            │    │
│  │  • PostgreSQL                                                           │    │
│  │  • Redis                                                                │    │
│  │  • No external access                                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Secret Management

| Secret | Storage | Rotation |
|--------|---------|----------|
| JWT signing keys | Docker Secrets | Quarterly |
| Database credentials | Docker Secrets | Monthly |
| API encryption keys | Docker Secrets | Quarterly |
| HMAC signing key | Docker Secrets | Annually |
| External API keys | Docker Secrets | As needed |

### 8.3 Security Checklist

- [ ] All traffic encrypted with TLS 1.3
- [ ] JWT tokens signed with RS256
- [ ] Database connections use SSL
- [ ] Secrets never in environment variables (use Docker Secrets)
- [ ] No sensitive data in logs
- [ ] Rate limiting on all endpoints
- [ ] CORS configured for known origins only
- [ ] CSP headers on all responses
- [ ] Regular dependency vulnerability scanning
- [ ] Audit logs retained for compliance period


---

## Architecture Notes

### Agent / Worker Permissions [MVP REQUIRED]

Recommended additional permissions:

- agent:read        → view agents/workers
- agent:manage      → pause/resume/assign/scale agents
- portal:manage     → set concurrency policy / pause portal

Role guidance:
- admin      → full manage
- operator   → read-only
- viewer     → read-only (explicitly no actions)

### Worker Authentication Rule [MVP REQUIRED]

Workers MUST:
- use short-lived service tokens only
- never use static API keys
- never expose secrets in logs

Purpose:
Limit blast radius if a worker is compromised.

### Sensitive Operations Protection [OPS]

Actions that change execution behavior should be audited:
- portal pause/resume
- concurrency change
- agent assignment
- manual override

All must generate audit events.

---
