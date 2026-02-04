## Scope Labels

This document defines the **evidence finalization & proof integrity model**.

Sections are labeled:

- **[MVP REQUIRED]** → mandatory for correctness and billing integrity
- **[PHASED / LATER]** → heavier sealing/packaging optimizations
- **[OPS]** → operational or storage guidance

This file is **safety‑critical**. Do NOT remove FINALIZING logic.

---

# Evidence Finalization Protocol

## FINALIZING State, Race Condition Prevention & Sealing Invariants

> **Scope:** [MVP REQUIRED]

> **Document Status:** Critical Implementation Requirement  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Logging Strategy](../security/VISA_LOGGING_STRATEGY.md) | [Database Schema](../database/VISA_DATABASE_SCHEMA.md) | [Worker Lifecycle](../architecture/VISA_WORKER_LIFECYCLE.md)

---

## Table of Contents

1. [The Race Condition Problem](#1-the-race-condition-problem)
2. [FINALIZING State](#2-finalizing-state)
3. [Evidence Collection Protocol](#3-evidence-collection-protocol)
4. [Sealing Invariants](#4-sealing-invariants)
5. [Implementation](#5-implementation)
6. [Failure Handling](#6-failure-handling)

---

## 1. The Race Condition Problem

### 1.1 The Bug

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    EVIDENCE RACE CONDITION                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  BROKEN FLOW (what can go wrong):                                                │
│                                                                                  │
│  Worker completes form submission                                                │
│       │                                                                          │
│       ├── Job status → COMPLETED ✓                                               │
│       │                                                                          │
│       ├── Browser context closed (to free RAM)                                   │
│       │                                                                          │
│       └── Background task: "Create evidence pack"                                │
│                │                                                                 │
│                ├── captureScreenshot() ← FAILS! Browser already closed           │
│                │                                                                 │
│                ├── getHtmlSnapshot() ← FAILS! Browser already closed             │
│                │                                                                 │
│                └── Evidence pack is INCOMPLETE or MISSING                        │
│                                                                                  │
│  RESULT:                                                                         │
│  • Job shows COMPLETED but has no evidence                                       │
│  • Billing cannot proceed (no sealed evidence)                                   │
│  • Customer dispute impossible to resolve                                        │
│  • Manual intervention required                                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Root Cause

The problem occurs when:
1. Job status is updated to `COMPLETED` immediately after form submission
2. Worker considers job "done" and closes browser context
3. Evidence collection runs asynchronously and finds no browser

**The evidence collection MUST complete BEFORE the job is marked as completed.**

---

## 2. FINALIZING State

### 2.1 Updated FSM

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    UPDATED FSM WITH FINALIZING STATE                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PROCESSING (submitting form)                                                    │
│       │                                                                          │
│       │ Submission confirmed                                                     │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  FINALIZING (NEW STATE)                                                 │    │
│  │  ═══════════════════════════════════════════════════════════════════    │    │
│  │                                                                         │    │
│  │  Purpose: Evidence collection phase                                     │    │
│  │  Browser: STILL OPEN (mandatory)                                        │    │
│  │  Duration: 10-60 seconds typically                                      │    │
│  │                                                                         │    │
│  │  Actions performed:                                                     │    │
│  │  1. Capture final screenshot (confirmation page)                        │    │
│  │  2. Capture HTML snapshot (DOM state)                                   │    │
│  │  3. Extract confirmation number from page                               │    │
│  │  4. Build FSM timeline from events                                      │    │
│  │  5. Collect HITL records (if any)                                       │    │
│  │  6. Create ZIP archive                                                  │    │
│  │  7. Compute manifest + hash                                             │    │
│  │  8. Upload to S3                                                        │    │
│  │  9. Seal evidence pack in DB                                            │    │
│  │  10. Emit EVIDENCE_PACK_SEALED event                                    │    │
│  │                                                                         │    │
│  │  Exit condition: Evidence pack status = SEALED                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │ Evidence sealed successfully                                             │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  COMPLETED                                                              │    │
│  │  • Billing eligible                                                     │    │
│  │  • Browser can now be closed                                            │    │
│  │  • Evidence pack immutable                                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  FAILURE IN FINALIZING:                                                          │
│       │                                                                          │
│       ├── Screenshot failed → FAILED_RETRYABLE (retry from FINALIZING)           │
│       ├── Upload failed → FAILED_RETRYABLE (retry from FINALIZING)               │
│       └── 3+ retries failed → FAILED_TERMINAL (manual review)                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Database Schema Update

```sql
-- Add FINALIZING to job_status enum
ALTER TYPE job_status ADD VALUE 'FINALIZING' AFTER 'PROCESSING';

-- Update job_status enum comment
COMMENT ON TYPE job_status IS '
  DRAFTED: Job created, not submitted
  QUEUED: Waiting for worker
  LOGIN_PROCESS: Authenticating with target site
  LOGGED_IN: Authenticated, ready to work
  FORM_FILLING: Filling application forms
  PAUSED: Safe parking state
  WAITING_HITL: Needs human intervention
  PROCESSING: Submitting application
  FINALIZING: Collecting evidence (browser still open)  <-- NEW
  COMPLETED: Done, evidence sealed
  FAILED_RETRYABLE: Temporary failure
  FAILED_TERMINAL: Permanent failure
';
```

### 2.3 State Transition Rules

| From | To | Trigger | Browser Required |
|------|-----|---------|------------------|
| PROCESSING | FINALIZING | Form submission confirmed | Yes |
| FINALIZING | COMPLETED | Evidence pack sealed | No (close after) |
| FINALIZING | FAILED_RETRYABLE | Evidence capture failed | Yes (keep open for retry) |
| FINALIZING | FAILED_TERMINAL | Max retries exceeded | No |

---

## 3. Evidence Collection Protocol

### 3.1 Collection Steps (In Order)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    EVIDENCE COLLECTION PROTOCOL                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  PRECONDITION: Browser context MUST be open and page MUST show confirmation      │
│                                                                                  │
│  STEP 1: WAIT FOR PAGE STABILITY (5 seconds)                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Wait for network idle (no pending requests)                          │    │
│  │  • Wait for DOM stability (no mutations for 2s)                         │    │
│  │  • Scroll to top of page                                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 2: CAPTURE FINAL SCREENSHOT                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Full page screenshot (not just viewport)                             │    │
│  │  • PNG format (lossless)                                                │    │
│  │  • Max dimensions: 1920x10000 (10k scroll)                              │    │
│  │  • Filename: screenshot_final.png                                       │    │
│  │  • Compute SHA-256 hash immediately                                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 3: CAPTURE HTML SNAPSHOT                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Get outerHTML of document                                            │    │
│  │  • Strip scripts (security)                                             │    │
│  │  • Inline critical CSS                                                  │    │
│  │  • Filename: snapshot.html                                              │    │
│  │  • Compute SHA-256 hash                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 4: EXTRACT CONFIRMATION DATA                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Parse confirmation number from page                                  │    │
│  │  • Extract appointment date/time (if applicable)                        │    │
│  │  • Extract reference numbers                                            │    │
│  │  • Store in confirmation.json                                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 5: BUILD FSM TIMELINE                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Query job_events for this job_id                                     │    │
│  │  • Include all state transitions                                        │    │
│  │  • Include timestamps and durations                                     │    │
│  │  • Filename: timeline.json                                              │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 6: COLLECT HITL RECORDS                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Query hitl_tasks for this job_id                                     │    │
│  │  • Include task type, resolution, resolver                              │    │
│  │  • Include timing (created, resolved, duration)                         │    │
│  │  • Filename: hitl.json (if any HITL occurred)                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 7: CREATE MANIFEST                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • List all files with SHA-256 hashes                                   │    │
│  │  • Include job metadata                                                 │    │
│  │  • Timestamp: now()                                                     │    │
│  │  • Compute manifest hash                                                │    │
│  │  • Sign manifest (HMAC-SHA256)                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 8: CREATE ZIP ARCHIVE                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Contents:                                                              │    │
│  │  • manifest.json (with signature)                                       │    │
│  │  • screenshot_final.png                                                 │    │
│  │  • snapshot.html                                                        │    │
│  │  • confirmation.json                                                    │    │
│  │  • timeline.json                                                        │    │
│  │  • hitl.json (optional)                                                 │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 9: UPLOAD TO S3                                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Path: s3://bucket/{tenant_id}/{year}/{month}/{job_id}/evidence.zip   │    │
│  │  • Server-side encryption enabled                                       │    │
│  │  • Verify upload (checksum)                                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 10: SEAL IN DATABASE                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  • Insert/update evidence_packs record                                  │    │
│  │  • Set status = SEALED                                                  │    │
│  │  • Set sealed_at = now()                                                │    │
│  │  • Store manifest_hash                                                  │    │
│  │  • Store manifest_sig                                                   │    │
│  │  • Emit EVIDENCE_PACK_SEALED event                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  POSTCONDITION: Only NOW can job status transition to COMPLETED                  │
│                 Only NOW can browser context be closed                           │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Time Budget

| Step | Max Duration | Retry on Failure |
|------|--------------|------------------|
| Page stability | 10s | No (abort if unstable) |
| Screenshot | 5s | Yes (3x) |
| HTML snapshot | 2s | Yes (3x) |
| Confirmation extraction | 2s | Yes (3x) |
| Timeline build | 1s | Yes (3x) |
| HITL records | 1s | Yes (3x) |
| Manifest creation | 1s | No |
| ZIP creation | 5s | Yes (2x) |
| S3 upload | 30s | Yes (3x) |
| DB seal | 2s | Yes (3x) |
| **Total max** | **~60s** | - |

---

## 4. Sealing Invariants

### 4.1 Invariants (MUST Always Be True)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    SEALING INVARIANTS                                            │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  INVARIANT 1: No COMPLETED without SEALED evidence                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  IF job.status == 'COMPLETED'                                           │    │
│  │  THEN evidence_pack.status == 'SEALED'                                  │    │
│  │                                                                         │    │
│  │  Enforcement: Transition to COMPLETED blocked until seal confirmed      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  INVARIANT 2: Browser open until seal complete                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  IF job.status == 'FINALIZING'                                          │    │
│  │  THEN browser_context.is_open == true                                   │    │
│  │                                                                         │    │
│  │  Enforcement: Worker code structure                                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  INVARIANT 3: Seal event always emitted                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  IF evidence_pack.status == 'SEALED'                                    │    │
│  │  THEN EXISTS job_event WHERE type == 'EVIDENCE_PACK_SEALED'             │    │
│  │                                                                         │    │
│  │  Enforcement: Transaction includes both updates                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  INVARIANT 4: Manifest hash matches stored hash                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  sha256(s3_object.manifest.json) == evidence_pack.manifest_hash         │    │
│  │                                                                         │    │
│  │  Enforcement: Verification endpoint + billing check                     │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  INVARIANT 5: No modifications after seal                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  IF evidence_pack.status == 'SEALED'                                    │    │
│  │  THEN no UPDATE allowed (except status → REVOKED with audit)            │    │
│  │                                                                         │    │
│  │  Enforcement: Application-level check + DB trigger                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Database Enforcement

```sql
-- Trigger to prevent modifications to sealed evidence packs
CREATE OR REPLACE FUNCTION prevent_sealed_modification()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'SEALED' AND NEW.status != 'REVOKED' THEN
    RAISE EXCEPTION 'Cannot modify sealed evidence pack. Use REVOKED status with audit.';
  END IF;
  
  IF OLD.status = 'SEALED' AND NEW.status = 'REVOKED' THEN
    IF NEW.revoked_reason IS NULL THEN
      RAISE EXCEPTION 'Revocation requires a reason.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_evidence_pack_immutable
  BEFORE UPDATE ON evidence_packs
  FOR EACH ROW
  EXECUTE FUNCTION prevent_sealed_modification();
```

---

## 5. Implementation

### 5.1 Worker Code Structure

```typescript
// worker/finalization.ts

import { Page, BrowserContext } from 'playwright';
import { Job, EvidencePack } from '../types';
import { createHash, createHmac } from 'crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import archiver from 'archiver';

interface FinalizationResult {
  success: boolean;
  evidencePackId?: string;
  error?: string;
}

export async function finalizeJob(
  job: Job,
  page: Page,
  context: BrowserContext
): Promise<FinalizationResult> {
  // CRITICAL: Do not close browser until this function returns successfully
  
  const files: Map<string, Buffer> = new Map();
  const hashes: Map<string, string> = new Map();
  
  try {
    // Transition to FINALIZING
    await db.jobs.update(job.id, { status: 'FINALIZING' });
    await emitEvent(job.id, 'STATE_TRANSITION', { from: 'PROCESSING', to: 'FINALIZING' });
    
    // STEP 1: Wait for page stability
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    await page.waitForTimeout(2000); // DOM stability
    
    // STEP 2: Capture screenshot
    const screenshot = await captureScreenshotWithRetry(page, 3);
    files.set('screenshot_final.png', screenshot);
    hashes.set('screenshot_final.png', sha256(screenshot));
    
    // STEP 3: Capture HTML snapshot
    const html = await captureHtmlSnapshot(page);
    files.set('snapshot.html', Buffer.from(html));
    hashes.set('snapshot.html', sha256(html));
    
    // STEP 4: Extract confirmation data
    const confirmation = await extractConfirmation(page, job);
    files.set('confirmation.json', Buffer.from(JSON.stringify(confirmation, null, 2)));
    hashes.set('confirmation.json', sha256(JSON.stringify(confirmation)));
    
    // STEP 5: Build timeline
    const timeline = await buildTimeline(job.id);
    files.set('timeline.json', Buffer.from(JSON.stringify(timeline, null, 2)));
    hashes.set('timeline.json', sha256(JSON.stringify(timeline)));
    
    // STEP 6: Collect HITL records
    const hitl = await collectHitlRecords(job.id);
    if (hitl.length > 0) {
      files.set('hitl.json', Buffer.from(JSON.stringify(hitl, null, 2)));
      hashes.set('hitl.json', sha256(JSON.stringify(hitl)));
    }
    
    // STEP 7: Create manifest
    const manifest = createManifest(job, hashes, confirmation);
    const manifestJson = JSON.stringify(manifest, null, 2);
    const manifestHash = sha256(manifestJson);
    const manifestSig = signManifest(manifestHash);
    
    // Add signature to manifest
    manifest.integrity = {
      manifest_hash: `sha256:${manifestHash}`,
      signing_method: 'HMAC-SHA256',
      signature: manifestSig
    };
    
    files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    
    // STEP 8: Create ZIP
    const zipBuffer = await createZipArchive(files);
    
    // STEP 9: Upload to S3
    const storageRef = await uploadToS3(job.tenant_id, job.id, zipBuffer);
    
    // STEP 10: Seal in database (transaction)
    const packId = await db.transaction(async (tx) => {
      // Create/update evidence pack
      const pack = await tx.evidencePacks.upsert({
        job_id: job.id,
        tenant_id: job.tenant_id,
        status: 'SEALED',
        storage_ref: storageRef,
        manifest_hash: manifestHash,
        manifest_sig: manifestSig,
        signing_method: 'HMAC-SHA256',
        contains_screenshot: true,
        contains_html_snapshot: true,
        contains_fsm_timeline: true,
        contains_hitl_records: hitl.length > 0,
        sealed_at: new Date()
      });
      
      // Update job to COMPLETED
      await tx.jobs.update(job.id, {
        status: 'COMPLETED',
        billable_outcome: confirmation.outcome_type,
        billing_status: 'ELIGIBLE'
      });
      
      // Emit events
      await tx.jobEvents.insert({
        job_id: job.id,
        tenant_id: job.tenant_id,
        event_type: 'EVIDENCE_PACK_SEALED',
        payload: { pack_id: pack.id, manifest_hash: manifestHash }
      });
      
      await tx.jobEvents.insert({
        job_id: job.id,
        tenant_id: job.tenant_id,
        event_type: 'BILLING_ELIGIBLE',
        payload: { billable_outcome: confirmation.outcome_type }
      });
      
      await tx.jobEvents.insert({
        job_id: job.id,
        tenant_id: job.tenant_id,
        event_type: 'STATE_TRANSITION',
        payload: { from: 'FINALIZING', to: 'COMPLETED' }
      });
      
      return pack.id;
    });
    
    // NOW we can close the browser
    return { success: true, evidencePackId: packId };
    
  } catch (error) {
    // Log error but DON'T close browser yet (might retry)
    console.error(`Finalization failed for job ${job.id}:`, error);
    
    // Transition to FAILED_RETRYABLE
    await db.jobs.update(job.id, { status: 'FAILED_RETRYABLE' });
    await emitEvent(job.id, 'FINALIZATION_FAILED', { 
      error: error.message,
      step: 'evidence_collection'
    });
    
    return { success: false, error: error.message };
  }
}

async function captureScreenshotWithRetry(page: Page, maxRetries: number): Promise<Buffer> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await page.screenshot({ 
        fullPage: true,
        type: 'png',
        timeout: 5000
      });
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      await page.waitForTimeout(1000);
    }
  }
  throw new Error('Screenshot capture failed after retries');
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function signManifest(manifestHash: string): string {
  const key = process.env.EVIDENCE_HMAC_KEY;
  if (!key) throw new Error('EVIDENCE_HMAC_KEY not configured');
  return createHmac('sha256', key).update(manifestHash).digest('hex');
}
```

### 5.2 Worker Main Loop Integration

```typescript
// worker/main.ts

async function processJob(job: Job): Promise<void> {
  const browser = await launchBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // ... login, form filling, etc.
    
    // Form submission successful
    await transitionTo(job.id, 'PROCESSING');
    await submitForm(page);
    
    // CRITICAL: Don't close browser here!
    // Finalization needs the browser open
    
    // Finalize and collect evidence
    const result = await finalizeJob(job, page, context);
    
    if (!result.success) {
      // Keep browser open for potential retry
      throw new Error(`Finalization failed: ${result.error}`);
    }
    
    // SUCCESS - now safe to close browser
    
  } finally {
    // Only close browser after finalization completes (or max retries)
    await context.close();
    await browser.close();
  }
}
```

---

## 6. Failure Handling

### 6.1 Failure Scenarios

| Failure Point | State After | Recovery |
|---------------|-------------|----------|
| Screenshot capture | FAILED_RETRYABLE | Retry from FINALIZING |
| HTML snapshot | FAILED_RETRYABLE | Retry from FINALIZING |
| S3 upload | FAILED_RETRYABLE | Retry from FINALIZING |
| DB seal | FAILED_RETRYABLE | Retry from FINALIZING |
| 3+ retries | FAILED_TERMINAL | Manual review |
| Browser crashed | FAILED_RETRYABLE | Retry from PROCESSING |

### 6.2 Recovery from FAILED_RETRYABLE in FINALIZING

```typescript
// When retrying a job that failed during FINALIZING
async function retryFromFinalizing(job: Job): Promise<void> {
  // Check if we have a valid browser session
  const hasValidSession = await checkProxySession(job);
  
  if (hasValidSession) {
    // Resume directly to FINALIZING
    // Re-establish browser, navigate to confirmation page
    await resumeFinalization(job);
  } else {
    // Need to redo from PROCESSING
    // Re-submit form and then finalize
    await retryFromProcessing(job);
  }
}
```

### 6.3 Manual Review for FAILED_TERMINAL

Jobs that fail finalization after max retries require manual review:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  MANUAL REVIEW CHECKLIST (FINALIZATION FAILURE)                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  □ Check job_events for STATE_TRANSITION to PROCESSING (form was submitted?)    │
│  □ Check if confirmation number exists in current_state                          │
│  □ Check S3 for partial evidence pack                                            │
│  □ Check target site manually for application status                             │
│                                                                                  │
│  IF form was actually submitted:                                                 │
│  □ Manually create evidence pack with available data                             │
│  □ Use admin-cli to mark job COMPLETED                                           │
│                                                                                  │
│  IF form was NOT submitted:                                                      │
│  □ Use admin-cli to requeue job                                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```


---

## Evidence Modes

### Mode A — Light Evidence [MVP REQUIRED]
- screenshot
- reference/confirmation number
- date/time
- stored DB record
- no ZIP/manifest/signature

### Mode B — Sealed Pack [PHASED / LATER]
- ZIP bundle
- manifest
- hash/HMAC
- immutable artifact
- verification endpoint

Both modes MUST pass through **FINALIZING** to avoid race conditions.

---
