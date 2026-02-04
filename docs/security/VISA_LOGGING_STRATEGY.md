## Scope Labels

This document defines **logging, audit trails, and evidence integrity strategy**.

- **[MVP REQUIRED]** → essential for production observability & legal safety
- **[OPS]** → operational/retention practices
- **[PHASED / LATER]** → heavier integrity/signing features

Logs are NOT evidence. Do not weaken separation between logs and evidence packs.

---

# Logging Strategy & Evidence Pack Guide

## Operational Logs vs. Billing-Grade Evidence

> **Document Status:** Reference  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Database Schema](../database/VISA_DATABASE_SCHEMA.md) | [Architecture Specification](../architecture/VISA_SAAS_ARCHITECTURE.md) | [Grafana Dashboards](../operations/VISA_GRAFANA_DASHBOARDS.md) | [Data Protection](../security/VISA_DATA_PROTECTION.md)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Log Categories](#2-log-categories)
3. [Operational Logging Standards](#3-operational-logging-standards)
4. [Evidence Pack Sealing & Signing](#4-evidence-pack-sealing--signing)
5. [Verification Procedures](#5-verification-procedures)
6. [Storage & Retention](#6-storage--retention)
7. [Implementation Guide](#7-implementation-guide)

---

## 1. Overview

### The Critical Distinction

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    LOGS vs. EVIDENCE PACKS: KEY DIFFERENCE                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  OPERATIONAL LOGS                                                       │    │
│  │  ═══════════════════════════════════════════════════════════════════    │    │
│  │  Purpose:    Debugging, monitoring, incident response                   │    │
│  │  Format:     Structured JSON to stdout                                  │    │
│  │  Retention:  30-90 days (operational window)                            │    │
│  │  Mutable:    Can be rotated, archived, purged                           │    │
│  │  Trust:      Internal operational use                                   │    │
│  │                                                                         │    │
│  │  NOT SUITABLE FOR: Billing disputes, legal evidence, customer proof     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  EVIDENCE PACKS                                                         │    │
│  │  ═══════════════════════════════════════════════════════════════════    │    │
│  │  Purpose:    Billing proof, dispute resolution, compliance              │    │
│  │  Format:     Sealed archive (ZIP) with manifest + signatures            │    │
│  │  Retention:  Per legal/compliance requirements (years)                  │    │
│  │  Immutable:  CANNOT be modified after sealing                           │    │
│  │  Trust:      Customer-facing, legally defensible                        │    │
│  │                                                                         │    │
│  │  SUITABLE FOR: "Pay per success" billing model proof                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ╔═════════════════════════════════════════════════════════════════════════╗    │
│  ║  RULE: Raw logs = Operations | Evidence Packs = Billing Proof           ║    │
│  ╚═════════════════════════════════════════════════════════════════════════╝    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Why This Separation Matters

| Scenario | Using Logs Only | Using Evidence Packs |
|----------|-----------------|---------------------|
| Customer disputes "job not completed" | Logs may be rotated, hard to prove | Sealed evidence with timestamp + screenshot |
| Audit request for billing | Ad-hoc log queries, inconsistent | Standardized pack with verified hash |
| Legal discovery | Logs lack integrity proof | Cryptographically signed, tamper-evident |
| Support ticket resolution | Engineers dig through logs | Customer downloads sealed proof directly |

---

## 2. Log Categories

### Log Hierarchy

| Category | Purpose | Destination | Retention |
|----------|---------|-------------|-----------|
| **Application Logs** | Runtime events, errors, debugging | stdout → Loki | 30-90 days |
| **Access Logs** | HTTP requests, authentication | Kong → Loki | 90 days |
| **Audit Events** | job_events table | PostgreSQL | Per partitioning policy |
| **Evidence Packs** | Billing-grade proof | Object Storage | Per compliance (years) |

### What Goes Where

| Event Type | Application Log | job_events | Evidence Pack |
|------------|-----------------|------------|---------------|
| Debug info | ✅ | ❌ | ❌ |
| State transitions | ✅ | ✅ | ✅ (in timeline) |
| Error details | ✅ | ✅ | ❌ |
| Final screenshot | ❌ | ❌ | ✅ |
| HITL interactions | ✅ | ✅ | ✅ |
| Confirmation number | ✅ | ✅ | ✅ |
| Performance metrics | ✅ | ❌ | ❌ |

---

## 3. Operational Logging Standards

### 3.1 Log Format

All application logs MUST use structured JSON format:

```json
{
  "timestamp": "2026-01-25T10:30:00.000Z",
  "level": "info",
  "service": "worker",
  "msg": "State transition completed",
  "tenant_id": "uuid-tenant",
  "job_id": "uuid-job",
  "run_id": "uuid-run",
  "from_state": "FORM_FILLING",
  "to_state": "PROCESSING",
  "duration_ms": 1523,
  "trace_id": "abc123"
}
```

### 3.2 Required Fields

| Field | Required | Description |
|-------|----------|-------------|
| `timestamp` | ✅ | ISO 8601 format with timezone |
| `level` | ✅ | debug, info, warn, error, fatal |
| `service` | ✅ | api, worker, etc. |
| `msg` | ✅ | Human-readable message |
| `tenant_id` | ✅* | Required for tenant-scoped operations |
| `job_id` | ✅* | Required for job-scoped operations |
| `trace_id` | Recommended | For distributed tracing correlation |

### 3.3 Sensitive Data Rules

| Data Type | Log Handling |
|-----------|--------------|
| Passwords | NEVER log |
| API keys | NEVER log |
| Full names | Hash or mask |
| Passport numbers | Mask (show last 4 only) |
| Form field values | Do not log content, only field names |
| Screenshots | Do not log (store in evidence pack only) |

---

## 4. Evidence Pack Sealing & Signing

### 4.1 Evidence Pack Contents

A sealed evidence pack contains everything needed to prove a job was completed successfully:

```
evidence_pack_{job_id}.zip
├── manifest.json           # Pack metadata + content hashes
├── screenshot_final.png    # Final confirmation screen
├── screenshot_*.png        # Additional key screenshots (optional)
├── html_snapshot.html      # DOM at completion (optional)
├── fsm_timeline.json       # Complete state transition history
├── hitl_records.json       # HITL interactions (if any)
└── confirmation.json       # Final outcome details
```

### 4.2 Sealing Rules (MUST)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          EVIDENCE PACK SEALING RULES                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  RULE 1: TERMINAL STATE ONLY                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Evidence packs are ONLY generated for terminal states:                 │    │
│  │  • COMPLETED (successful - billable)                                    │    │
│  │  • FAILED_TERMINAL (failed - not billable, but may need proof)          │    │
│  │                                                                         │    │
│  │  Never for: PAUSED, FAILED_RETRYABLE, or any in-progress state          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  RULE 2: IMMUTABLE AFTER SEAL                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Once status = SEALED:                                                  │    │
│  │  • NO modifications to pack contents                                    │    │
│  │  • NO updates to manifest                                               │    │
│  │  • NO re-generation of signatures                                       │    │
│  │                                                                         │    │
│  │  Violation = security incident requiring audit                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  RULE 3: EVIDENCE_PACK_SEALED EVENT MANDATORY                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Sealing MUST emit job_event:                                           │    │
│  │  • event_type: EVIDENCE_PACK_SEALED                                     │    │
│  │  • payload includes: pack_id, manifest_hash, sealed_at                  │    │
│  │                                                                         │    │
│  │  No event = seal never happened (verification will fail)                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  RULE 4: HASH BEFORE UPLOAD                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Manifest hash MUST be computed BEFORE uploading to storage:            │    │
│  │  1. Generate all content files                                          │    │
│  │  2. Compute SHA-256 of each file                                        │    │
│  │  3. Build manifest.json with file hashes                                │    │
│  │  4. Compute SHA-256 of manifest.json                                    │    │
│  │  5. Sign manifest hash (if signing enabled)                             │    │
│  │  6. Upload pack to storage                                              │    │
│  │  7. Store manifest_hash in DB                                           │    │
│  │  8. Emit EVIDENCE_PACK_SEALED event                                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Signing Options

Three levels of integrity protection are supported:

#### Option A: SHA-256 Manifest (Baseline)

**Provides:** Tamper detection  
**Does NOT provide:** Proof of origin  

```typescript
// Baseline: SHA-256 hash only
const manifestHash = crypto
  .createHash('sha256')
  .update(JSON.stringify(manifest))
  .digest('hex');

// Store in DB
await db.query(`
  UPDATE evidence_packs 
  SET manifest_hash = $1, signing_method = 'SHA256', status = 'SEALED'
  WHERE id = $2
`, [manifestHash, packId]);
```

**manifest.json:**
```json
{
  "integrity": {
    "manifest_hash": "sha256:a1b2c3d4e5f6...",
    "signing_method": "SHA256"
  }
}
```

#### Option B: HMAC-SHA256 (Recommended)

**Provides:** Tamper detection + proof of origin (our system signed it)  
**Requires:** `EVIDENCE_HMAC_KEY` secret  

```typescript
// Recommended: HMAC signature
const hmacKey = loadSecret('EVIDENCE_HMAC_KEY');
const manifestHash = crypto
  .createHash('sha256')
  .update(JSON.stringify(manifest))
  .digest('hex');

const signature = crypto
  .createHmac('sha256', hmacKey)
  .update(manifestHash)
  .digest('hex');

// Store in DB
await db.query(`
  UPDATE evidence_packs 
  SET manifest_hash = $1, manifest_sig = $2, signing_method = 'HMAC-SHA256', status = 'SEALED'
  WHERE id = $3
`, [manifestHash, signature, packId]);
```

**manifest.json:**
```json
{
  "integrity": {
    "manifest_hash": "sha256:a1b2c3d4e5f6...",
    "signing_method": "HMAC-SHA256",
    "signature": "hmac:x1y2z3..."
  }
}
```

#### Option C: Ed25519 Asymmetric (Enterprise)

**Provides:** Tamper detection + verifiable by third parties (public key can be shared)  
**Requires:** Key pair management  

```typescript
// Enterprise: Asymmetric signature
import { sign } from '@noble/ed25519';

const privateKey = loadSecret('EVIDENCE_SIGNING_KEY');
const manifestHash = crypto
  .createHash('sha256')
  .update(JSON.stringify(manifest))
  .digest('hex');

const signature = await sign(
  Buffer.from(manifestHash, 'hex'),
  privateKey
);

// Store in DB
await db.query(`
  UPDATE evidence_packs 
  SET manifest_hash = $1, manifest_sig = $2, signing_method = 'Ed25519', status = 'SEALED'
  WHERE id = $3
`, [manifestHash, Buffer.from(signature).toString('hex'), packId]);
```

**manifest.json:**
```json
{
  "integrity": {
    "manifest_hash": "sha256:a1b2c3d4e5f6...",
    "signing_method": "Ed25519",
    "signature": "ed25519:...",
    "public_key": "ed25519-pub:..."
  }
}
```

### 4.4 Signing Method Comparison

| Method | Tamper Detection | Origin Proof | Third-Party Verifiable | Complexity |
|--------|------------------|--------------|------------------------|------------|
| SHA-256 | ✅ | ❌ | ❌ | Low |
| HMAC-SHA256 | ✅ | ✅ | ❌ (key is secret) | Medium |
| Ed25519 | ✅ | ✅ | ✅ (public key shared) | High |

**Recommendation:** Start with HMAC-SHA256. Upgrade to Ed25519 if third-party verification is required.

---

## 5. Verification Procedures

### 5.1 Complete Verification Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      EVIDENCE PACK VERIFICATION FLOW                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Input: job_id, downloaded evidence_pack.zip                                     │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 1: LOAD DATABASE RECORD                                           │    │
│  │  SELECT manifest_hash, manifest_sig, signing_method, sealed_at          │    │
│  │  FROM evidence_packs WHERE job_id = $1 AND status = 'SEALED';           │    │
│  │                                                                         │    │
│  │  → If no sealed record exists: FAIL (pack never sealed)                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 2: VERIFY MANIFEST HASH                                           │    │
│  │  • Extract manifest.json from pack                                      │    │
│  │  • Compute SHA-256 of manifest.json                                     │    │
│  │  • Compare with DB manifest_hash                                        │    │
│  │                                                                         │    │
│  │  → If mismatch: FAIL (pack tampered or corrupted)                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 3: VERIFY SIGNATURE (if present)                                  │    │
│  │  • If HMAC-SHA256: Recompute HMAC with key, compare                     │    │
│  │  • If Ed25519: Verify signature with public key                         │    │
│  │  • If SHA256 only: Skip (no signature)                                  │    │
│  │                                                                         │    │
│  │  → If mismatch: FAIL (signature invalid)                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 4: VERIFY CONTENT FILES                                           │    │
│  │  • For each file listed in manifest.json:                               │    │
│  │    - Extract file from pack                                             │    │
│  │    - Compute SHA-256                                                    │    │
│  │    - Compare with manifest entry                                        │    │
│  │                                                                         │    │
│  │  → If any mismatch: FAIL (content tampered)                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  STEP 5: VERIFY SEALED EVENT EXISTS                                     │    │
│  │  SELECT 1 FROM job_events                                               │    │
│  │  WHERE job_id = $1 AND event_type = 'EVIDENCE_PACK_SEALED';            │    │
│  │                                                                         │    │
│  │  → If no event: WARN (seal event missing, investigate)                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ╔═════════════════════════════════════════════════════════════════════════╗    │
│  ║  VERIFICATION PASSED                                                    ║    │
│  ║  Evidence pack is authentic and unmodified                              ║    │
│  ╚═════════════════════════════════════════════════════════════════════════╝    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Verification Script

```typescript
// verify-evidence-pack.ts
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as unzipper from 'unzipper';

interface VerificationResult {
  valid: boolean;
  checks: {
    db_record: 'pass' | 'fail';
    manifest_hash: 'pass' | 'fail';
    signature: 'pass' | 'fail' | 'skipped';
    content_files: 'pass' | 'fail';
    seal_event: 'pass' | 'warn' | 'fail';
  };
  errors: string[];
}

async function verifyEvidencePack(
  jobId: string,
  packPath: string,
  db: Database,
  hmacKey?: string
): Promise<VerificationResult> {
  const result: VerificationResult = {
    valid: false,
    checks: {
      db_record: 'fail',
      manifest_hash: 'fail',
      signature: 'skipped',
      content_files: 'fail',
      seal_event: 'fail'
    },
    errors: []
  };

  // Step 1: Load DB record
  const record = await db.query(`
    SELECT manifest_hash, manifest_sig, signing_method, sealed_at
    FROM evidence_packs 
    WHERE job_id = $1 AND status = 'SEALED'
  `, [jobId]);

  if (!record) {
    result.errors.push('No sealed evidence pack record in database');
    return result;
  }
  result.checks.db_record = 'pass';

  // Step 2: Extract and verify manifest hash
  const pack = await unzipper.Open.file(packPath);
  const manifestEntry = pack.files.find(f => f.path === 'manifest.json');
  if (!manifestEntry) {
    result.errors.push('manifest.json not found in pack');
    return result;
  }

  const manifestContent = await manifestEntry.buffer();
  const computedHash = crypto
    .createHash('sha256')
    .update(manifestContent)
    .digest('hex');

  if (computedHash !== record.manifest_hash) {
    result.errors.push(`Manifest hash mismatch: expected ${record.manifest_hash}, got ${computedHash}`);
    return result;
  }
  result.checks.manifest_hash = 'pass';

  // Step 3: Verify signature
  if (record.signing_method === 'HMAC-SHA256' && hmacKey) {
    const expectedSig = crypto
      .createHmac('sha256', hmacKey)
      .update(record.manifest_hash)
      .digest('hex');

    if (expectedSig !== record.manifest_sig) {
      result.errors.push('HMAC signature verification failed');
      return result;
    }
    result.checks.signature = 'pass';
  } else if (record.signing_method === 'SHA256') {
    result.checks.signature = 'skipped';
  }

  // Step 4: Verify content files
  const manifest = JSON.parse(manifestContent.toString());
  for (const [filename, info] of Object.entries(manifest.contents)) {
    const fileEntry = pack.files.find(f => f.path === (info as any).file);
    if (!fileEntry) {
      result.errors.push(`Missing file: ${(info as any).file}`);
      return result;
    }

    const fileContent = await fileEntry.buffer();
    const fileHash = crypto
      .createHash('sha256')
      .update(fileContent)
      .digest('hex');

    if (fileHash !== (info as any).sha256) {
      result.errors.push(`Hash mismatch for ${(info as any).file}`);
      return result;
    }
  }
  result.checks.content_files = 'pass';

  // Step 5: Verify seal event exists
  const sealEvent = await db.query(`
    SELECT 1 FROM job_events 
    WHERE job_id = $1 AND event_type = 'EVIDENCE_PACK_SEALED'
  `, [jobId]);

  result.checks.seal_event = sealEvent ? 'pass' : 'warn';
  if (!sealEvent) {
    result.errors.push('Warning: EVIDENCE_PACK_SEALED event not found');
  }

  // All checks passed
  result.valid = result.checks.manifest_hash === 'pass' 
    && result.checks.content_files === 'pass'
    && (result.checks.signature === 'pass' || result.checks.signature === 'skipped');

  return result;
}
```

---

## 6. Storage & Retention

### 6.1 Storage Requirements

| Data Type | Storage | Encryption | Retention |
|-----------|---------|------------|-----------|
| Application Logs | Loki (cloud) | In transit | 30-90 days |
| job_events | PostgreSQL | At rest | Per partition policy |
| Evidence Packs | Object Storage (S3) | At rest + in transit | Per compliance (2-7 years) |

### 6.2 Evidence Pack Storage Path

```
s3://visa-evidence-packs/
└── {tenant_id}/
    └── {year}/
        └── {month}/
            └── {job_id}/
                └── evidence_pack.zip
```

**Path stored in DB:** `s3://visa-evidence-packs/tenant-uuid/2026/01/job-uuid/evidence_pack.zip`

### 6.3 Lifecycle Rules

```yaml
# S3 Lifecycle Configuration
Rules:
  - ID: evidence-pack-retention
    Status: Enabled
    Filter:
      Prefix: ""
    Transitions:
      - Days: 90
        StorageClass: STANDARD_IA
      - Days: 365
        StorageClass: GLACIER
    # Do NOT set expiration - evidence must be retained per compliance
```

---

## 7. Implementation Guide

### 7.1 Sealing Workflow

```typescript
// seal-evidence-pack.ts
async function sealEvidencePack(jobId: string): Promise<void> {
  const job = await db.jobs.findOne({ id: jobId });
  
  if (job.status !== 'COMPLETED') {
    throw new Error('Can only seal evidence for COMPLETED jobs');
  }

  // Check if already sealed
  const existing = await db.evidencePacks.findOne({ job_id: jobId, status: 'SEALED' });
  if (existing) {
    throw new Error('Evidence pack already sealed');
  }

  // 1. Generate evidence pack contents
  const contents = {
    screenshot_final: await captureScreenshot(job),
    fsm_timeline: await getTimelineEvents(jobId),
    hitl_records: await getHitlRecords(jobId),
    confirmation: {
      confirmation_number: job.confirmation_number,
      completed_at: job.completed_at
    }
  };

  // 2. Build manifest with file hashes
  const manifest = buildManifest(jobId, job.tenant_id, contents);

  // 3. Compute manifest hash
  const manifestJson = JSON.stringify(manifest);
  const manifestHash = crypto
    .createHash('sha256')
    .update(manifestJson)
    .digest('hex');

  // 4. Sign manifest (HMAC)
  const hmacKey = loadSecret('EVIDENCE_HMAC_KEY');
  const signature = crypto
    .createHmac('sha256', hmacKey)
    .update(manifestHash)
    .digest('hex');

  // 5. Create ZIP archive
  const packPath = await createPackArchive(manifest, contents);

  // 6. Upload to storage
  const storageRef = await uploadToStorage(packPath, job.tenant_id, jobId);

  // 7. Create/update DB record (in transaction)
  await db.transaction(async (tx) => {
    // Update evidence_packs
    await tx.evidencePacks.upsert({
      job_id: jobId,
      tenant_id: job.tenant_id,
      status: 'SEALED',
      storage_ref: storageRef,
      manifest_hash: manifestHash,
      manifest_sig: signature,
      signing_method: 'HMAC-SHA256',
      sealed_at: new Date()
    });

    // Update job billing status
    await tx.jobs.update(jobId, {
      billing_status: 'ELIGIBLE',
      billable_outcome: 'VISA_SUBMITTED'
    });

    // Emit events
    await tx.jobEvents.insert({
      job_id: jobId,
      tenant_id: job.tenant_id,
      event_type: 'EVIDENCE_PACK_SEALED',
      payload: { pack_id: packId, manifest_hash: manifestHash }
    });

    await tx.jobEvents.insert({
      job_id: jobId,
      tenant_id: job.tenant_id,
      event_type: 'BILLING_ELIGIBLE',
      payload: { billable_outcome: 'VISA_SUBMITTED' }
    });
  });

  console.log(`Evidence pack sealed for job ${jobId}`);
}
```

### 7.2 Implementation Checklist

- [ ] **Secrets Configuration**
  - [ ] `EVIDENCE_HMAC_KEY` generated and stored securely
  - [ ] Key rotation procedure documented

- [ ] **Storage Setup**
  - [ ] S3 bucket created with encryption enabled
  - [ ] Lifecycle rules configured
  - [ ] IAM policies for worker access

- [ ] **Database**
  - [ ] `evidence_packs` table created
  - [ ] Billing fields added to `jobs` table
  - [ ] New event types documented

- [ ] **Application**
  - [ ] Sealing workflow implemented
  - [ ] Verification endpoint implemented
  - [ ] Billing eligibility triggers working

- [ ] **Monitoring**
  - [ ] Alert on seal failures
  - [ ] Alert on verification failures
  - [ ] Dashboard for billing pipeline


---

## Architecture Notes

### Light Evidence Mode (MVP)

For first production:
- screenshot
- confirmation/reference number
- timestamp
- DB record

ZIP/manifest/signature sealing is optional and can be enabled later.
FINALIZING state still applies to prevent race conditions.

### Sensitive Data Logging Rules [MVP REQUIRED]

Workers and APIs MUST NEVER log:
- decrypted PII
- passport numbers
- OTP codes
- CAPTCHA answers
- payment/card data

Always mask or redact.

### Portal Canary / Change Events [OPS]

Recommended additional event:
- PORTAL_CHANGE_DETECTED

Used for:
- monitoring
- alerts
- adapter redesign triggers

---
