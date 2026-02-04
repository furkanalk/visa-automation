## Scope Labels

This document defines **data protection, privacy, and security controls**.

- **[MVP REQUIRED]** → mandatory for production handling of PII
- **[OPS]** → operational/monitoring practices
- **[PHASED / LATER]** → future enhancements

This is a security-critical document. Do not remove encryption, masking, or deletion rules.

---

# Data Protection & PII Handling Specification

## PII Classification, Encryption, Key Management & Evidence Pack Integrity

> **Document Status:** Locked Specification  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Security Model](../security/VISA_SECURITY_MODEL.md) | [Logging Strategy](../security/VISA_LOGGING_STRATEGY.md) | [Database Schema](../database/VISA_DATABASE_SCHEMA.md)

---

## Table of Contents

1. [Data Classification](#1-data-classification)
2. [PII Field Registry](#2-pii-field-registry)
3. [Encryption Strategy](#3-encryption-strategy)
4. [Key Management](#4-key-management)
5. [Data Masking & Redaction](#5-data-masking--redaction)
6. [Evidence Pack Integrity](#6-evidence-pack-integrity)
7. [Data Retention & Deletion](#7-data-retention--deletion)
8. [Compliance Mapping](#8-compliance-mapping)

---

## 1. Data Classification

### 1.1 Classification Levels

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          DATA CLASSIFICATION LEVELS                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  LEVEL 1: PUBLIC                                                        │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Definition:  Information that can be freely disclosed                  │    │
│  │  Examples:    API documentation, public pricing, system status          │    │
│  │  Protection:  None required                                             │    │
│  │  Logging:     Full details allowed                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  LEVEL 2: INTERNAL                                                      │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Definition:  Business data not meant for public disclosure             │    │
│  │  Examples:    Job IDs, tenant IDs, workflow states, timestamps          │    │
│  │  Protection:  Access control, TLS in transit                            │    │
│  │  Logging:     IDs and metadata allowed, not content                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  LEVEL 3: CONFIDENTIAL (PII)                                            │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Definition:  Personally identifiable information                       │    │
│  │  Examples:    Names, passport numbers, dates of birth, addresses        │    │
│  │  Protection:  Encryption at rest, strict access control                 │    │
│  │  Logging:     NEVER log - mask or redact                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  LEVEL 4: RESTRICTED (Sensitive PII)                                    │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Definition:  Highly sensitive personal data                            │    │
│  │  Examples:    Passport scans, biometric data, health info               │    │
│  │  Protection:  Field-level encryption, audit all access                  │    │
│  │  Logging:     NEVER log - not even masked                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  LEVEL 5: SECRET                                                        │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Definition:  Cryptographic keys, credentials                           │    │
│  │  Examples:    Encryption keys, API secrets, passwords                   │    │
│  │  Protection:  HSM/KMS, never stored in application DB                   │    │
│  │  Logging:     NEVER log under any circumstances                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Classification by Data Type

| Data Type | Classification | Storage | Logging | Retention |
|-----------|---------------|---------|---------|-----------|
| Job ID | Internal | Plain | Allowed | Indefinite |
| Tenant ID | Internal | Plain | Allowed | Indefinite |
| Timestamps | Internal | Plain | Allowed | Per policy |
| Job Status | Internal | Plain | Allowed | Per policy |
| Full Name | Confidential | Encrypted | Masked | Per request |
| Date of Birth | Confidential | Encrypted | Redacted | Per request |
| Passport Number | Restricted | Encrypted | Redacted | Per request |
| Passport Scan | Restricted | Encrypted | Never | Per request |
| Email Address | Confidential | Encrypted | Masked | Per request |
| Phone Number | Confidential | Encrypted | Masked | Per request |
| Physical Address | Confidential | Encrypted | Redacted | Per request |
| Encryption Keys | Secret | KMS/HSM | Never | Per rotation |

---

## 2. PII Field Registry

### 2.1 Complete PII Field Catalog

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          PII FIELD REGISTRY                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  This registry identifies ALL fields containing PII across the system.           │
│  Any new field containing PII MUST be added to this registry.                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### jobs.current_state JSONB

| JSON Path | PII Type | Classification | Encryption | Masking Rule |
|-----------|----------|----------------|------------|--------------|
| `$.applicant.full_name` | Name | Confidential | AES-256-GCM | `J*** D**` |
| `$.applicant.given_name` | Name | Confidential | AES-256-GCM | `J***` |
| `$.applicant.family_name` | Name | Confidential | AES-256-GCM | `D**` |
| `$.applicant.date_of_birth` | DOB | Confidential | AES-256-GCM | `****-**-15` |
| `$.applicant.passport_number` | ID Document | Restricted | AES-256-GCM | `******3456` |
| `$.applicant.passport_expiry` | Date | Confidential | AES-256-GCM | `20**-**-**` |
| `$.applicant.nationality` | Nationality | Confidential | AES-256-GCM | Full (low risk) |
| `$.applicant.email` | Email | Confidential | AES-256-GCM | `j***@***.com` |
| `$.applicant.phone` | Phone | Confidential | AES-256-GCM | `+1******1234` |
| `$.applicant.address.street` | Address | Confidential | AES-256-GCM | Redacted |
| `$.applicant.address.city` | Address | Confidential | AES-256-GCM | Full (low risk) |
| `$.applicant.address.postal_code` | Address | Confidential | AES-256-GCM | `12***` |
| `$.travel.destination_country` | Travel | Internal | None | Full |
| `$.travel.entry_date` | Travel | Internal | None | Full |
| `$.form_data.*` | Mixed | Confidential | AES-256-GCM | Field-specific |

#### Document Storage (S3)

| Object Type | Classification | Encryption | Access Control |
|-------------|----------------|------------|----------------|
| Passport scan | Restricted | AES-256 (S3 SSE) | Tenant + audit |
| ID document | Restricted | AES-256 (S3 SSE) | Tenant + audit |
| Photo | Restricted | AES-256 (S3 SSE) | Tenant + audit |
| Supporting docs | Confidential | AES-256 (S3 SSE) | Tenant |
| Evidence pack | Confidential | AES-256 (S3 SSE) | Tenant + audit |

#### Evidence Pack Contents

| Content | Classification | Encryption | Contains PII |
|---------|----------------|------------|--------------|
| Final screenshot | Confidential | Pack-level | Yes (visible form data) |
| HTML snapshot | Confidential | Pack-level | Yes (DOM contains data) |
| FSM timeline | Internal | Pack-level | No (IDs only) |
| HITL records | Internal | Pack-level | Possibly (context) |

### 2.2 PII Detection Rules

```typescript
// PII detection patterns for validation and scanning
const piiPatterns = {
  // Passport numbers (various formats)
  passport: /^[A-Z]{1,2}[0-9]{6,9}$/i,
  
  // Email addresses
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  
  // Phone numbers (international)
  phone: /^\+?[1-9]\d{1,14}$/,
  
  // Dates of birth (various formats)
  dob: /^(19|20)\d{2}[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])$/,
  
  // Credit card numbers
  creditCard: /^[0-9]{13,19}$/,
  
  // Social security / national ID
  nationalId: /^[0-9]{3}-?[0-9]{2}-?[0-9]{4}$/,
};

// Fields that should NEVER appear in logs
const neverLogFields = [
  'passport_number',
  'date_of_birth',
  'ssn',
  'national_id',
  'credit_card',
  'password',
  'secret',
  'token',
  'key',
];
```

---

## 3. Encryption Strategy

### 3.1 Encryption Layers

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          ENCRYPTION ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  LAYER 1: TRANSPORT ENCRYPTION (TLS 1.3)                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • All external traffic: HTTPS only                                     │    │
│  │  • Internal service-to-service: mTLS (optional)                         │    │
│  │  • Database connections: SSL required                                   │    │
│  │  • Redis connections: TLS enabled                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  LAYER 2: STORAGE ENCRYPTION (At Rest)                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • PostgreSQL: Transparent Data Encryption (TDE) or volume encryption   │    │
│  │  • S3: Server-Side Encryption (SSE-S3 or SSE-KMS)                       │    │
│  │  • Redis: Encrypted persistence (if enabled)                            │    │
│  │  • Backups: Encrypted with separate key                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  LAYER 3: FIELD-LEVEL ENCRYPTION (Application)                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • PII fields encrypted before storage                                  │    │
│  │  • Decrypted only when needed                                           │    │
│  │  • Key per tenant (tenant isolation)                                    │    │
│  │  • Algorithm: AES-256-GCM                                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Field-Level Encryption Implementation

```typescript
// Field-level encryption service
import * as crypto from 'crypto';

interface EncryptedField {
  ciphertext: string;  // Base64 encoded
  iv: string;          // Base64 encoded
  tag: string;         // Base64 encoded (GCM auth tag)
  keyVersion: number;  // For key rotation
}

class FieldEncryption {
  private algorithm = 'aes-256-gcm';
  private ivLength = 12;
  private tagLength = 16;

  async encrypt(
    plaintext: string,
    tenantId: string
  ): Promise<EncryptedField> {
    // Get tenant's data encryption key (DEK)
    const { key, version } = await this.getTenantKey(tenantId);
    
    // Generate random IV
    const iv = crypto.randomBytes(this.ivLength);
    
    // Encrypt
    const cipher = crypto.createCipheriv(this.algorithm, key, iv, {
      authTagLength: this.tagLength
    });
    
    let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
    ciphertext += cipher.final('base64');
    
    const tag = cipher.getAuthTag();
    
    return {
      ciphertext,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      keyVersion: version
    };
  }

  async decrypt(
    encrypted: EncryptedField,
    tenantId: string
  ): Promise<string> {
    // Get tenant's key (specific version for rotation support)
    const { key } = await this.getTenantKey(tenantId, encrypted.keyVersion);
    
    const iv = Buffer.from(encrypted.iv, 'base64');
    const tag = Buffer.from(encrypted.tag, 'base64');
    
    const decipher = crypto.createDecipheriv(this.algorithm, key, iv, {
      authTagLength: this.tagLength
    });
    decipher.setAuthTag(tag);
    
    let plaintext = decipher.update(encrypted.ciphertext, 'base64', 'utf8');
    plaintext += decipher.final('utf8');
    
    return plaintext;
  }

  private async getTenantKey(
    tenantId: string,
    version?: number
  ): Promise<{ key: Buffer; version: number }> {
    // In production: retrieve from KMS/HSM
    // DEK is encrypted with tenant's KEK (Key Encryption Key)
    return await keyManagement.getDataEncryptionKey(tenantId, version);
  }
}
```

### 3.3 Encrypted Field Storage Format

```json
{
  "applicant": {
    "full_name": {
      "_encrypted": true,
      "ciphertext": "base64...",
      "iv": "base64...",
      "tag": "base64...",
      "keyVersion": 2
    },
    "passport_number": {
      "_encrypted": true,
      "ciphertext": "base64...",
      "iv": "base64...",
      "tag": "base64...",
      "keyVersion": 2
    },
    "nationality": "US"  // Not encrypted (low sensitivity)
  }
}
```

---

## 4. Key Management

### 4.1 Key Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          KEY HIERARCHY                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  MASTER KEY (MK)                                                        │    │
│  │  • Stored in HSM/KMS (never exported)                                   │    │
│  │  • Used only to encrypt/decrypt KEKs                                    │    │
│  │  • Rotation: Annually or on compromise                                  │    │
│  └───────────────────────────────────┬─────────────────────────────────────┘    │
│                                      │                                           │
│                                      │ Encrypts                                  │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  KEY ENCRYPTION KEYS (KEK) - Per Tenant                                 │    │
│  │  • One KEK per tenant                                                   │    │
│  │  • Stored encrypted in database                                         │    │
│  │  • Used to encrypt/decrypt tenant's DEKs                                │    │
│  │  • Rotation: Quarterly or on request                                    │    │
│  └───────────────────────────────────┬─────────────────────────────────────┘    │
│                                      │                                           │
│                                      │ Encrypts                                  │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  DATA ENCRYPTION KEYS (DEK) - Per Tenant, Versioned                     │    │
│  │  • Used for actual field encryption                                     │    │
│  │  • Stored encrypted with tenant's KEK                                   │    │
│  │  • Multiple versions for rotation support                               │    │
│  │  • Rotation: Monthly or on request                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  SEPARATE KEY TYPES:                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • EVIDENCE_HMAC_KEY: For evidence pack signing (shared)                │    │
│  │  • JWT_SIGNING_KEY: For token signing (RSA key pair)                    │    │
│  │  • WEBHOOK_SIGNING_KEY: For webhook HMAC (per tenant)                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Key Storage Schema

```sql
CREATE TABLE encryption_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id),  -- NULL for system keys
  key_type        TEXT NOT NULL,                -- 'KEK', 'DEK', 'HMAC', etc.
  key_version     INTEGER NOT NULL,
  encrypted_key   BYTEA NOT NULL,               -- Encrypted with parent key
  algorithm       TEXT NOT NULL,                -- 'AES-256-GCM', 'RSA-2048', etc.
  status          TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, ROTATION, RETIRED
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at      TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_by      UUID,
  
  UNIQUE (tenant_id, key_type, key_version)
);

CREATE INDEX idx_encryption_keys_tenant ON encryption_keys (tenant_id, key_type, status);
```

### 4.3 Key Rotation Procedure

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          KEY ROTATION PROCEDURE                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PHASE 1: PREPARATION                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Generate new key version (N+1)                                      │    │
│  │  2. Store new key encrypted with KEK                                    │    │
│  │  3. Set new key status = ACTIVE                                         │    │
│  │  4. Set old key status = ROTATION                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  PHASE 2: DUAL-KEY OPERATION                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. New encryptions use key version N+1                                 │    │
│  │  2. Decryptions use key version from ciphertext metadata                │    │
│  │  3. Both keys remain available                                          │    │
│  │  4. Duration: Until re-encryption complete                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  PHASE 3: RE-ENCRYPTION (Background)                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Query records with keyVersion = N                                   │    │
│  │  2. Decrypt with old key                                                │    │
│  │  3. Re-encrypt with new key                                             │    │
│  │  4. Update record                                                       │    │
│  │  5. Process in batches (non-blocking)                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  PHASE 4: RETIREMENT                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Verify no records use old key version                               │    │
│  │  2. Set old key status = RETIRED                                        │    │
│  │  3. Keep retired key for compliance period                              │    │
│  │  4. Eventually: Secure deletion                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Key Rotation Schedule

| Key Type | Rotation Frequency | Trigger Events |
|----------|-------------------|----------------|
| Master Key | Annually | Compromise, compliance |
| KEK (per tenant) | Quarterly | Tenant request, compliance |
| DEK (per tenant) | Monthly | Automatic, tenant request |
| JWT Signing Key | Quarterly | Automatic |
| HMAC Signing Key | Annually | Compliance |
| Webhook Keys | On request | Tenant request |

### 4.5 Key Rotation Runbook

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       KEY ROTATION RUNBOOK                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  This runbook ensures zero-downtime, auditable key rotation for all key types.   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 4.5.1 DEK Rotation (Monthly, Automated)

**Trigger:** Cron job on 1st of each month, 02:00 UTC

```bash
#!/bin/bash
# rotate-dek.sh - Run as scheduled job

set -euo pipefail
LOG_FILE="/var/log/key-rotation/dek-$(date +%Y%m%d).log"

echo "$(date) - Starting DEK rotation" >> "$LOG_FILE"

# 1. Generate new DEK for each tenant
psql -d visa_production -c "
  INSERT INTO encryption_keys (tenant_id, key_type, key_version, encrypted_key, algorithm, status)
  SELECT 
    tenant_id,
    'DEK',
    COALESCE(MAX(key_version), 0) + 1,
    encrypt_with_kek(gen_random_bytes(32), tenant_id),  -- New 256-bit key
    'AES-256-GCM',
    'ACTIVE'
  FROM encryption_keys
  WHERE key_type = 'DEK' AND status = 'ACTIVE'
  GROUP BY tenant_id;
"

# 2. Mark old keys as ROTATION (still usable for decrypt)
psql -d visa_production -c "
  UPDATE encryption_keys
  SET status = 'ROTATION'
  WHERE key_type = 'DEK'
    AND status = 'ACTIVE'
    AND key_version < (
      SELECT MAX(key_version) FROM encryption_keys e2
      WHERE e2.tenant_id = encryption_keys.tenant_id AND e2.key_type = 'DEK'
    );
"

# 3. Queue background re-encryption job
curl -X POST http://localhost:3001/admin/jobs/reencrypt \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"batch_size": 1000, "delay_ms": 100}'

echo "$(date) - DEK rotation initiated, re-encryption queued" >> "$LOG_FILE"
```

**Monitoring:** Alert if re-encryption not complete within 24 hours.

#### 4.5.2 Evidence HMAC Key Rotation (Annual)

**Trigger:** Manual, with 30-day notice period

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  EVIDENCE HMAC KEY ROTATION PROCEDURE                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  DAY -30: PREPARATION                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Generate new HMAC key:                                              │    │
│  │     openssl rand -base64 32 > evidence_hmac_key_v2.txt                  │    │
│  │                                                                         │    │
│  │  2. Store in secrets management:                                        │    │
│  │     docker secret create evidence_hmac_key_v2 evidence_hmac_key_v2.txt  │    │
│  │                                                                         │    │
│  │  3. Update application config to recognize both keys:                   │    │
│  │     EVIDENCE_HMAC_KEY_CURRENT=v2                                        │    │
│  │     EVIDENCE_HMAC_KEY_V1=<old_key>                                      │    │
│  │     EVIDENCE_HMAC_KEY_V2=<new_key>                                      │    │
│  │                                                                         │    │
│  │  4. Audit: Record rotation initiation in audit_log                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  DAY 0: ACTIVATION                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Deploy updated config:                                              │    │
│  │     - New evidence packs signed with v2                                 │    │
│  │     - Verification accepts both v1 and v2                               │    │
│  │                                                                         │    │
│  │  2. Monitor: Verify new packs are signed correctly                      │    │
│  │                                                                         │    │
│  │  3. Audit: Record activation in audit_log                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  DAY +365: DECOMMISSION OLD KEY                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Verify: All active evidence packs use v2                            │    │
│  │     SELECT COUNT(*) FROM evidence_packs                                 │    │
│  │     WHERE signing_key_version = 'v1' AND status = 'SEALED';             │    │
│  │     -- Must be 0 or only archived packs                                 │    │
│  │                                                                         │    │
│  │  2. Remove v1 from active config (keep in cold storage for audit)       │    │
│  │                                                                         │    │
│  │  3. Audit: Record decommission in audit_log                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 4.5.3 JWT Signing Key Rotation (Quarterly)

```bash
#!/bin/bash
# rotate-jwt-keys.sh

# 1. Generate new RSA key pair
openssl genrsa -out jwt_private_v2.pem 2048
openssl rsa -in jwt_private_v2.pem -pubout -out jwt_public_v2.pem

# 2. Store in secrets
docker secret create jwt_private_key_v2 jwt_private_v2.pem
docker secret create jwt_public_key_v2 jwt_public_v2.pem

# 3. Update Kong to accept both keys (JWKS endpoint)
# Kong validates tokens against all public keys in JWKS

# 4. Deploy API with new signing key
# - New tokens signed with v2
# - Old tokens (v1) still valid until expiry

# 5. After token TTL (max 7 days for refresh tokens):
# - Remove v1 from JWKS
# - Remove v1 secrets
```

#### 4.5.4 Emergency Key Rotation (Compromise Response)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  EMERGENCY KEY ROTATION - SUSPECTED COMPROMISE                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  SEVERITY: P1 - Execute immediately                                              │
│                                                                                  │
│  STEP 1: CONTAINMENT (< 15 minutes)                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  □ Identify compromised key type                                        │    │
│  │  □ Set incident mode: PAUSE_ALL (if DEK/Master Key)                     │    │
│  │  □ Revoke all active sessions (if JWT key)                              │    │
│  │  □ Disable affected API keys (if API key leak)                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 2: ROTATION (< 1 hour)                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  □ Generate new key using standard procedure                            │    │
│  │  □ Deploy new key to all services                                       │    │
│  │  □ Mark old key as COMPROMISED (not RETIRED)                            │    │
│  │  □ For DEK: Queue emergency re-encryption (priority batch)              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 3: VERIFICATION (< 2 hours)                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  □ Verify new key is active and working                                 │    │
│  │  □ Verify old key is rejected                                           │    │
│  │  □ Resume normal operations                                             │    │
│  │  □ Notify affected tenants (if customer data at risk)                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 4: POST-INCIDENT (< 24 hours)                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  □ Complete incident report                                             │    │
│  │  □ Root cause analysis                                                  │    │
│  │  □ Update security procedures if needed                                 │    │
│  │  □ Compliance notification (if required)                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### 4.5.5 Key Rotation Audit Requirements

All key rotations MUST be logged:

```sql
-- Audit log entry for key rotation
INSERT INTO audit_log (
  action,
  resource_type,
  metadata,
  created_at
) VALUES (
  'key.rotated',
  'encryption_key',
  jsonb_build_object(
    'key_type', 'DEK',
    'tenant_id', 'uuid',
    'old_version', 1,
    'new_version', 2,
    'rotation_reason', 'scheduled',  -- or 'compromise', 'tenant_request'
    'initiated_by', 'system'         -- or 'admin_user_id'
  ),
  now()
);
```

---

## 5. Data Masking & Redaction

### 5.1 Masking Rules

```typescript
// Masking rules by field type
const maskingRules = {
  // Full name: "John Doe" → "J*** D**"
  fullName: (value: string): string => {
    const parts = value.split(' ');
    return parts.map(part => 
      part[0] + '*'.repeat(Math.max(part.length - 1, 2))
    ).join(' ');
  },

  // Email: "john.doe@example.com" → "j***@***.com"
  email: (value: string): string => {
    const [local, domain] = value.split('@');
    const [domainName, tld] = domain.split('.');
    return `${local[0]}***@***.${tld}`;
  },

  // Phone: "+1234567890" → "+1******890"
  phone: (value: string): string => {
    if (value.length < 6) return '******';
    return value.slice(0, 2) + '*'.repeat(value.length - 5) + value.slice(-3);
  },

  // Passport: "AB1234567" → "******567"
  passport: (value: string): string => {
    return '*'.repeat(Math.max(value.length - 3, 3)) + value.slice(-3);
  },

  // Date of birth: "1985-06-15" → "****-**-15"
  dateOfBirth: (value: string): string => {
    const parts = value.split('-');
    return `****-**-${parts[2] || '**'}`;
  },

  // Address: Full redaction
  address: (_value: string): string => '[REDACTED]',

  // Postal code: "12345" → "12***"
  postalCode: (value: string): string => {
    return value.slice(0, 2) + '*'.repeat(Math.max(value.length - 2, 3));
  },
};
```

### 5.2 Logging Sanitization

```typescript
// Log sanitizer - removes/masks PII before logging
function sanitizeForLogging(obj: any, path: string = ''): any {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    // Check if this path contains PII
    if (isPiiPath(path)) {
      return '[REDACTED]';
    }
    // Check if value looks like PII
    if (looksLikePii(obj)) {
      return '[DETECTED_PII]';
    }
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map((item, i) => sanitizeForLogging(item, `${path}[${i}]`));
  }
  
  if (typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key;
      
      // Skip sensitive keys entirely
      if (isSensitiveKey(key)) {
        result[key] = '[REDACTED]';
        continue;
      }
      
      result[key] = sanitizeForLogging(value, newPath);
    }
    return result;
  }
  
  return obj;
}

const sensitiveKeys = new Set([
  'password', 'secret', 'token', 'key', 'credential',
  'passport_number', 'ssn', 'national_id', 'credit_card',
  'date_of_birth', 'dob', 'birth_date'
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return sensitiveKeys.has(lower) || 
         lower.includes('password') ||
         lower.includes('secret') ||
         lower.includes('token');
}
```

### 5.3 API Response Masking

Different masking levels based on context:

| Context | Masking Level | Example |
|---------|--------------|---------|
| Full access (decryption) | None | `John Doe` |
| Standard API response | Partial | `J*** D**` |
| Public/webhook | Full redaction | `[REDACTED]` |
| Logs | Full redaction | `[REDACTED]` |
| Evidence pack | None (encrypted pack) | `John Doe` |

---

## 6. Evidence Pack Integrity

### 6.1 Cryptographic Chain

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    EVIDENCE PACK INTEGRITY CHAIN                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  STEP 1: CONTENT HASHING                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  For each file in evidence pack:                                        │    │
│  │  • screenshot_final.png → SHA-256 → "abc123..."                         │    │
│  │  • timeline.json → SHA-256 → "def456..."                                │    │
│  │  • hitl.json → SHA-256 → "ghi789..."                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 2: MANIFEST GENERATION                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  manifest.json = {                                                      │    │
│  │    "job_id": "...",                                                     │    │
│  │    "sealed_at": "2026-01-25T12:00:00Z",                                 │    │
│  │    "contents": {                                                        │    │
│  │      "screenshot_final.png": { "sha256": "abc123..." },                 │    │
│  │      "timeline.json": { "sha256": "def456..." },                        │    │
│  │      "hitl.json": { "sha256": "ghi789..." }                             │    │
│  │    }                                                                    │    │
│  │  }                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 3: MANIFEST HASHING                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  manifest_hash = SHA-256(manifest.json)                                 │    │
│  │  → "sha256:xyz789..."                                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 4: SIGNING (HMAC-SHA256)                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  signature = HMAC-SHA256(EVIDENCE_HMAC_KEY, manifest_hash)              │    │
│  │  → "hmac:signature..."                                                  │    │
│  │                                                                         │    │
│  │  Add to manifest:                                                       │    │
│  │  "integrity": {                                                         │    │
│  │    "manifest_hash": "sha256:xyz789...",                                 │    │
│  │    "signature": "hmac:signature...",                                    │    │
│  │    "signing_method": "HMAC-SHA256"                                      │    │
│  │  }                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 5: DATABASE RECORD                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  evidence_packs table:                                                  │    │
│  │  • manifest_hash = "sha256:xyz789..."                                   │    │
│  │  • manifest_sig = "hmac:signature..."                                   │    │
│  │  • signing_method = "HMAC-SHA256"                                       │    │
│  │  • status = "SEALED"                                                    │    │
│  │  • sealed_at = now()                                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  VERIFICATION: Compare pack hash with DB hash, verify HMAC signature             │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Signing Key Security

```yaml
# Evidence HMAC key requirements
EVIDENCE_HMAC_KEY:
  algorithm: HMAC-SHA256
  key_length: 256 bits (32 bytes)
  storage: Docker Secrets / HashiCorp Vault
  rotation: Annually
  access: Worker service only
  backup: Encrypted offline backup

# Key generation
openssl rand -base64 32 > evidence_hmac_key.txt
```

### 6.3 Tamper Detection

If any of these checks fail, the evidence pack is considered tampered:

| Check | Failure Indicates |
|-------|-------------------|
| Manifest hash mismatch | Manifest modified after sealing |
| HMAC signature invalid | Pack not signed by our system |
| Content hash mismatch | Individual file modified |
| Seal event missing | Pack may not have been properly sealed |
| DB record mismatch | Database record tampered |

---

## 7. Data Retention & Deletion

### 7.1 Retention Periods

| Data Type | Active | Archive | Delete |
|-----------|--------|---------|--------|
| Job metadata | 2 years | +5 years | 7 years total |
| PII (applicant data) | 90 days | On request | On completion + 90 days |
| Evidence packs | 2 years | +5 years | 7 years total |
| Audit logs | 1 year | +6 years | 7 years total |
| Session data | 30 days | N/A | 30 days |
| Operational logs | 90 days | N/A | 90 days |

### 7.2 Right to Deletion (GDPR Article 17)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     DATA DELETION REQUEST WORKFLOW                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  REQUEST RECEIVED                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Verify requester identity                                           │    │
│  │  2. Validate deletion scope (which data)                                │    │
│  │  3. Check for legal holds or retention requirements                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  DELETION EXECUTION                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  PII in job records:                                                    │    │
│  │  • Set applicant fields to null/redacted                                │    │
│  │  • Keep job metadata (ID, status, timestamps) for audit                 │    │
│  │                                                                         │    │
│  │  Documents:                                                             │    │
│  │  • Delete from S3 (with deletion marker for versioned buckets)          │    │
│  │                                                                         │    │
│  │  Evidence packs:                                                        │    │
│  │  • Mark as REDACTED (not deleted - billing proof)                       │    │
│  │  • Remove PII-containing files                                          │    │
│  │  • Keep timeline and metadata                                           │    │
│  │                                                                         │    │
│  │  Audit logs:                                                            │    │
│  │  • NOT deleted (legal requirement)                                      │    │
│  │  • PII in logs already redacted                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  CONFIRMATION                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. Generate deletion certificate                                       │    │
│  │  2. Audit log: data_deletion_completed                                  │    │
│  │  3. Notify requester                                                    │    │
│  │  4. Timeline: 30 days from request                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Secure Deletion

```sql
-- PII deletion (pseudonymization)
UPDATE jobs
SET current_state = jsonb_set(
  current_state,
  '{applicant}',
  '{"deleted": true, "deleted_at": "2026-01-25T12:00:00Z"}'::jsonb
)
WHERE id = $1;

-- Evidence pack redaction
UPDATE evidence_packs
SET status = 'REDACTED',
    contains_screenshot = false,
    contains_html_snapshot = false,
    redacted_at = now(),
    redacted_reason = 'GDPR deletion request'
WHERE job_id = $1;
```

---

## 8. Compliance Mapping

### 8.1 GDPR Compliance

| GDPR Article | Requirement | Implementation |
|--------------|-------------|----------------|
| Art. 5 | Data minimization | Only collect necessary PII |
| Art. 6 | Lawful basis | Consent + contract fulfillment |
| Art. 17 | Right to erasure | Deletion workflow |
| Art. 20 | Data portability | Export API |
| Art. 25 | Privacy by design | Encryption, masking |
| Art. 32 | Security of processing | Encryption, access control |
| Art. 33 | Breach notification | Incident response plan |

### 8.2 Security Controls Matrix

| Control | Classification | Implementation |
|---------|---------------|----------------|
| Encryption at rest | Confidential+ | AES-256-GCM |
| Encryption in transit | All | TLS 1.3 |
| Access control | All | RBAC + tenant isolation |
| Audit logging | All | Immutable audit trail |
| Key management | Secret | KMS/HSM |
| Data masking | Confidential+ | Field-level masking |
| Secure deletion | Confidential+ | Cryptographic erasure |


---

## Architecture Notes

### Payment Card Data Policy [MVP REQUIRED]

If payments are processed internally:
- NEVER store raw card numbers or CVV in DB
- NEVER log card data
- use ephemeral memory only
- prefer external PSP/tokenization

Purpose:
Avoid PCI-DSS scope and reduce legal risk.

### Worker Runtime Decryption Rule [MVP REQUIRED]

Workers may decrypt PII only:
- in-memory
- during execution

Workers MUST NOT:
- store decrypted data in Redis
- log decrypted values
- persist to temp files

### Evidence Mode Clarification

- Light evidence (MVP): screenshot + reference + datetime
- Sealed evidence (Later): signed/immutable package

Both respect data retention policies.

---
