## Scope Labels

This document defines **payment lifecycle & billing behavior**.

- **[MVP REQUIRED]** → required if platform handles payments directly
- **[PHASED / LATER]** → customer portal / external billing / enterprise features
- **[OPS]** → reconciliation, reporting, finance ops

If payments are handled internally first (card owned by operator), only minimal capture/cancel logic is required for MVP.

---

# Payments Lifecycle

## Transaction Flow, Payment Gateway Integration & Billing Automation

> **Document Status:** Business Critical  
> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Related Documents:** [Database Schema](../database/VISA_DATABASE_SCHEMA.md) | [API Contract](../api/VISA_CORE_API_CONTRACT.md) | [Evidence Finalization](../business/VISA_EVIDENCE_FINALIZATION.md)

---

## Table of Contents

1. [Payment Models](#1-payment-models)
2. [Database Schema](#2-database-schema)
3. [Payment Flow (Stripe)](#3-payment-flow-stripe)
4. [Payment Flow (Iyzico)](#4-payment-flow-iyzico)
5. [Webhook Handling](#5-webhook-handling)
6. [Billing Automation](#6-billing-automation)
7. [Dispute Handling](#7-dispute-handling)
8. [Reconciliation](#8-reconciliation)

---

## 1. Payment Models

> **Scope:** [PHASED / LATER]

### 1.1 Supported Models

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PAYMENT MODEL OPTIONS                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  MODEL A: PRE-AUTHORIZATION (Recommended for B2B)                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                         │    │
│  │  1. Customer submits job → Card authorized (hold)                       │    │
│  │  2. Job processing begins                                               │    │
│  │  3. Job COMPLETED → Capture payment                                     │    │
│  │  4. Job FAILED_TERMINAL → Release authorization                         │    │
│  │                                                                         │    │
│  │  Pros: Customer only charged on success                                 │    │
│  │  Cons: Auth holds expire (7 days typically)                             │    │
│  │  Best for: Short processing times (<7 days)                             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  MODEL B: CHARGE UPFRONT + REFUND                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                         │    │
│  │  1. Customer submits job → Full charge                                  │    │
│  │  2. Job processing begins                                               │    │
│  │  3. Job COMPLETED → Keep payment                                        │    │
│  │  4. Job FAILED_TERMINAL → Issue refund                                  │    │
│  │                                                                         │    │
│  │  Pros: No expiration, simpler                                           │    │
│  │  Cons: Customer sees charge immediately, refund delays                  │    │
│  │  Best for: Longer processing times                                      │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  MODEL C: POST-COMPLETION INVOICE (Enterprise B2B)                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                         │    │
│  │  1. Customer submits job → No immediate charge                          │    │
│  │  2. Job processing completes                                            │    │
│  │  3. Monthly invoice generated for all COMPLETED jobs                    │    │
│  │  4. Payment due NET-30                                                  │    │
│  │                                                                         │    │
│  │  Pros: Cash flow friendly for customers                                 │    │
│  │  Cons: Credit risk, AR management                                       │    │
│  │  Best for: Trusted enterprise accounts                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  RECOMMENDED: Model A (Pre-Auth) for standard, Model C for enterprise            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Pricing Structure

| Item | Type | Amount | Notes |
|------|------|--------|-------|
| Visa application processing | Per success | $XX.XX | Based on visa type |
| Priority processing | Add-on | $XX.XX | VIP queue |
| HITL intervention | Included | $0 | Part of base fee |
| Retry (system fault) | Included | $0 | No charge |
| Retry (customer fault) | Per retry | $X.XX | Optional |

---

## 2. Database Schema

> **Scope:** [MVP REQUIRED]

### 2.1 Payment Intents Table

```sql
-- Payment intents track the lifecycle of each payment attempt
CREATE TYPE payment_intent_status AS ENUM (
  'CREATED',           -- Intent created, not yet authorized
  'AUTHORIZED',        -- Card authorized, funds held
  'CAPTURED',          -- Payment captured, funds transferred
  'CANCELLED',         -- Authorization cancelled/released
  'REFUNDED',          -- Full refund issued
  'PARTIALLY_REFUNDED',-- Partial refund issued
  'FAILED',            -- Payment failed
  'DISPUTED'           -- Chargeback/dispute opened
);

CREATE TABLE payment_intents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  job_id            UUID REFERENCES jobs(id),            -- NULL for invoice payments
  invoice_id        UUID REFERENCES invoices(id),        -- NULL for per-job payments
  
  -- Payment provider details
  provider          TEXT NOT NULL,                        -- 'stripe', 'iyzico'
  provider_intent_id TEXT NOT NULL UNIQUE,               -- Stripe PaymentIntent ID or Iyzico token
  provider_charge_id TEXT,                                -- After capture
  
  -- Amount
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  
  -- Status
  status            payment_intent_status NOT NULL DEFAULT 'CREATED',
  
  -- Metadata
  description       TEXT,
  metadata          JSONB,                                -- Provider-specific data
  
  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorized_at     TIMESTAMPTZ,
  captured_at       TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  refunded_at       TIMESTAMPTZ,
  
  -- Error tracking
  last_error        TEXT,
  failure_reason    TEXT
);

CREATE INDEX idx_payment_intents_tenant ON payment_intents (tenant_id, created_at DESC);
CREATE INDEX idx_payment_intents_job ON payment_intents (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_payment_intents_provider ON payment_intents (provider, provider_intent_id);
CREATE INDEX idx_payment_intents_status ON payment_intents (status) 
  WHERE status IN ('AUTHORIZED', 'DISPUTED');
```

### 2.2 Invoices Table (for Model C)

```sql
CREATE TYPE invoice_status AS ENUM (
  'DRAFT',
  'SENT',
  'PAID',
  'OVERDUE',
  'CANCELLED',
  'DISPUTED'
);

CREATE TABLE invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  invoice_number    TEXT NOT NULL UNIQUE,                 -- INV-2026-0001
  
  -- Billing period
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  
  -- Amounts
  subtotal_cents    INTEGER NOT NULL,
  tax_cents         INTEGER NOT NULL DEFAULT 0,
  total_cents       INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'USD',
  
  -- Status
  status            invoice_status NOT NULL DEFAULT 'DRAFT',
  
  -- Payment
  due_date          DATE NOT NULL,
  paid_at           TIMESTAMPTZ,
  payment_intent_id UUID REFERENCES payment_intents(id),
  
  -- Timestamps
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at           TIMESTAMPTZ,
  
  -- PDF storage
  pdf_storage_ref   TEXT                                  -- S3 path to PDF
);

CREATE TABLE invoice_line_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        UUID NOT NULL REFERENCES invoices(id),
  job_id            UUID REFERENCES jobs(id),
  
  description       TEXT NOT NULL,
  quantity          INTEGER NOT NULL DEFAULT 1,
  unit_price_cents  INTEGER NOT NULL,
  total_cents       INTEGER NOT NULL,
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_tenant ON invoices (tenant_id, created_at DESC);
CREATE INDEX idx_invoices_status ON invoices (status) WHERE status IN ('SENT', 'OVERDUE');
```

### 2.3 Update jobs Table

```sql
-- Add payment reference to jobs (for Model A/B)
ALTER TABLE jobs ADD COLUMN payment_intent_id UUID REFERENCES payment_intents(id);
```

---

## 3. Payment Flow (Stripe)

### 3.1 Pre-Authorization Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    STRIPE PRE-AUTHORIZATION FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  STEP 1: CREATE PAYMENT INTENT (Job Submission)                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Customer → POST /jobs                                                  │    │
│  │                                                                         │    │
│  │  Backend:                                                               │    │
│  │  1. Validate job request                                                │    │
│  │  2. Calculate price                                                     │    │
│  │  3. Create Stripe PaymentIntent (capture_method: 'manual')              │    │
│  │  4. Create job with status = DRAFTED                                    │    │
│  │  5. Return client_secret to frontend                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  STEP 2: CONFIRM PAYMENT (Frontend)                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Frontend:                                                              │    │
│  │  1. Display payment form (Stripe Elements)                              │    │
│  │  2. stripe.confirmCardPayment(client_secret)                            │    │
│  │  3. Handle 3D Secure if required                                        │    │
│  │  4. On success → POST /jobs/:id/confirm-payment                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  STEP 3: AUTHORIZE & QUEUE (Backend)                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Backend receives webhook: payment_intent.succeeded                     │    │
│  │                                                                         │    │
│  │  1. Verify webhook signature                                            │    │
│  │  2. Update payment_intents.status = AUTHORIZED                          │    │
│  │  3. Update job.status = QUEUED                                          │    │
│  │  4. Emit JOB_QUEUED event                                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       │  Job processing happens...                                               │
│       ▼                                                                          │
│  STEP 4A: CAPTURE ON SUCCESS                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Job reaches COMPLETED with sealed evidence                             │    │
│  │                                                                         │    │
│  │  Backend:                                                               │    │
│  │  1. stripe.paymentIntents.capture(intent_id)                            │    │
│  │  2. Update payment_intents.status = CAPTURED                            │    │
│  │  3. Update job.billing_status = BILLED                                  │    │
│  │  4. Emit BILLED event                                                   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
│  STEP 4B: CANCEL ON FAILURE                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Job reaches FAILED_TERMINAL                                            │    │
│  │                                                                         │    │
│  │  Backend:                                                               │    │
│  │  1. stripe.paymentIntents.cancel(intent_id)                             │    │
│  │  2. Update payment_intents.status = CANCELLED                           │    │
│  │  3. Emit PAYMENT_CANCELLED event                                        │    │
│  │  4. Notify customer: "No charge - job failed"                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Stripe Integration Code

```typescript
// services/payments/stripe.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16'
});

interface CreatePaymentIntentInput {
  tenantId: string;
  jobId: string;
  amountCents: number;
  currency: string;
  description: string;
  customerId?: string;  // Stripe Customer ID for saved cards
}

export async function createPaymentIntent(
  input: CreatePaymentIntentInput
): Promise<{ clientSecret: string; intentId: string }> {
  
  // Create Stripe PaymentIntent with manual capture
  const paymentIntent = await stripe.paymentIntents.create({
    amount: input.amountCents,
    currency: input.currency,
    capture_method: 'manual',  // Authorization only
    description: input.description,
    customer: input.customerId,
    metadata: {
      tenant_id: input.tenantId,
      job_id: input.jobId
    },
    // Automatic payment methods (cards, etc.)
    automatic_payment_methods: {
      enabled: true
    }
  });
  
  // Store in our database
  await db.paymentIntents.insert({
    tenant_id: input.tenantId,
    job_id: input.jobId,
    provider: 'stripe',
    provider_intent_id: paymentIntent.id,
    amount_cents: input.amountCents,
    currency: input.currency,
    status: 'CREATED',
    description: input.description
  });
  
  return {
    clientSecret: paymentIntent.client_secret!,
    intentId: paymentIntent.id
  };
}

export async function capturePayment(jobId: string): Promise<void> {
  const intent = await db.paymentIntents.findOne({
    job_id: jobId,
    status: 'AUTHORIZED'
  });
  
  if (!intent) {
    throw new Error(`No authorized payment intent for job ${jobId}`);
  }
  
  // Capture in Stripe
  const captured = await stripe.paymentIntents.capture(intent.provider_intent_id);
  
  // Update our database
  await db.paymentIntents.update(intent.id, {
    status: 'CAPTURED',
    provider_charge_id: captured.latest_charge as string,
    captured_at: new Date()
  });
  
  // Emit event
  await emitEvent(jobId, 'PAYMENT_CAPTURED', {
    amount: intent.amount_cents,
    currency: intent.currency
  });
}

export async function cancelAuthorization(jobId: string): Promise<void> {
  const intent = await db.paymentIntents.findOne({
    job_id: jobId,
    status: 'AUTHORIZED'
  });
  
  if (!intent) return; // No auth to cancel
  
  // Cancel in Stripe
  await stripe.paymentIntents.cancel(intent.provider_intent_id);
  
  // Update our database
  await db.paymentIntents.update(intent.id, {
    status: 'CANCELLED',
    cancelled_at: new Date()
  });
  
  // Emit event
  await emitEvent(jobId, 'PAYMENT_CANCELLED', {
    reason: 'job_failed'
  });
}

export async function refundPayment(
  jobId: string, 
  reason: string,
  amountCents?: number  // Partial refund if specified
): Promise<void> {
  const intent = await db.paymentIntents.findOne({
    job_id: jobId,
    status: 'CAPTURED'
  });
  
  if (!intent || !intent.provider_charge_id) {
    throw new Error(`No captured payment for job ${jobId}`);
  }
  
  // Create refund in Stripe
  const refund = await stripe.refunds.create({
    charge: intent.provider_charge_id,
    amount: amountCents,  // Full refund if undefined
    reason: 'requested_by_customer',
    metadata: {
      job_id: jobId,
      reason: reason
    }
  });
  
  // Update our database
  const newStatus = amountCents ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
  await db.paymentIntents.update(intent.id, {
    status: newStatus,
    refunded_at: new Date()
  });
  
  // Emit event
  await emitEvent(jobId, 'PAYMENT_REFUNDED', {
    amount: amountCents || intent.amount_cents,
    refund_id: refund.id,
    reason
  });
}
```

---

## 4. Payment Flow (Iyzico)

### 4.1 Iyzico Integration (Turkey)

```typescript
// services/payments/iyzico.ts
import Iyzipay from 'iyzipay';

const iyzipay = new Iyzipay({
  apiKey: process.env.IYZICO_API_KEY!,
  secretKey: process.env.IYZICO_SECRET_KEY!,
  uri: process.env.IYZICO_URI!  // sandbox or production
});

interface CreateIyzicoPaymentInput {
  tenantId: string;
  jobId: string;
  amountTRY: number;
  buyer: {
    id: string;
    name: string;
    surname: string;
    email: string;
    identityNumber: string;
    phone: string;
    ip: string;
    city: string;
    country: string;
    address: string;
  };
  card?: {
    cardHolderName: string;
    cardNumber: string;
    expireMonth: string;
    expireYear: string;
    cvc: string;
  };
  callbackUrl: string;
}

export async function createIyzicoPayment(
  input: CreateIyzicoPaymentInput
): Promise<{ htmlContent: string; token: string }> {
  
  const request = {
    locale: Iyzipay.LOCALE.TR,
    conversationId: input.jobId,
    price: input.amountTRY.toString(),
    paidPrice: input.amountTRY.toString(),
    currency: Iyzipay.CURRENCY.TRY,
    installment: '1',
    basketId: input.jobId,
    paymentChannel: Iyzipay.PAYMENT_CHANNEL.WEB,
    paymentGroup: Iyzipay.PAYMENT_GROUP.SERVICE,
    callbackUrl: input.callbackUrl,
    buyer: {
      id: input.buyer.id,
      name: input.buyer.name,
      surname: input.buyer.surname,
      gsmNumber: input.buyer.phone,
      email: input.buyer.email,
      identityNumber: input.buyer.identityNumber,
      registrationAddress: input.buyer.address,
      ip: input.buyer.ip,
      city: input.buyer.city,
      country: input.buyer.country
    },
    billingAddress: {
      contactName: `${input.buyer.name} ${input.buyer.surname}`,
      city: input.buyer.city,
      country: input.buyer.country,
      address: input.buyer.address
    },
    basketItems: [{
      id: input.jobId,
      name: 'Visa Application Processing',
      category1: 'Services',
      itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
      price: input.amountTRY.toString()
    }]
  };
  
  return new Promise((resolve, reject) => {
    iyzipay.checkoutFormInitialize.create(request, (err, result) => {
      if (err) return reject(err);
      
      if (result.status !== 'success') {
        return reject(new Error(result.errorMessage));
      }
      
      // Store in database
      db.paymentIntents.insert({
        tenant_id: input.tenantId,
        job_id: input.jobId,
        provider: 'iyzico',
        provider_intent_id: result.token,
        amount_cents: Math.round(input.amountTRY * 100),
        currency: 'TRY',
        status: 'CREATED'
      }).then(() => {
        resolve({
          htmlContent: result.checkoutFormContent,
          token: result.token
        });
      });
    });
  });
}

// Callback handler
export async function handleIyzicoCallback(token: string): Promise<{
  success: boolean;
  jobId?: string;
  error?: string;
}> {
  return new Promise((resolve, reject) => {
    iyzipay.checkoutForm.retrieve({ token }, async (err, result) => {
      if (err) return reject(err);
      
      const intent = await db.paymentIntents.findOne({
        provider: 'iyzico',
        provider_intent_id: token
      });
      
      if (!intent) {
        return resolve({ success: false, error: 'Intent not found' });
      }
      
      if (result.status === 'success' && result.paymentStatus === 'SUCCESS') {
        // Payment successful
        await db.paymentIntents.update(intent.id, {
          status: 'CAPTURED',  // Iyzico captures immediately
          provider_charge_id: result.paymentId,
          captured_at: new Date()
        });
        
        // Queue the job
        await db.jobs.update(intent.job_id, { status: 'QUEUED' });
        
        return resolve({ success: true, jobId: intent.job_id });
      } else {
        // Payment failed
        await db.paymentIntents.update(intent.id, {
          status: 'FAILED',
          last_error: result.errorMessage
        });
        
        return resolve({ 
          success: false, 
          error: result.errorMessage,
          jobId: intent.job_id
        });
      }
    });
  });
}
```

---

## 5. Webhook Handling

> **Scope:** [PHASED / LATER]

### 5.1 Stripe Webhooks

```typescript
// routes/webhooks/stripe.ts
import { Router } from 'express';
import Stripe from 'stripe';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

router.post('/stripe', 
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    
    let event: Stripe.Event;
    
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return res.status(400).send('Webhook Error');
    }
    
    // Idempotency: Check if we've processed this event
    const processed = await db.webhookEvents.findOne({
      provider: 'stripe',
      event_id: event.id
    });
    
    if (processed) {
      return res.json({ received: true, duplicate: true });
    }
    
    // Record event
    await db.webhookEvents.insert({
      provider: 'stripe',
      event_id: event.id,
      event_type: event.type,
      payload: event.data.object,
      processed_at: new Date()
    });
    
    // Handle event
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
        
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
        break;
        
      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object as Stripe.Dispute);
        break;
        
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
        
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    
    res.json({ received: true });
  }
);

async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const intent = await db.paymentIntents.findOne({
    provider_intent_id: paymentIntent.id
  });
  
  if (!intent) {
    console.error(`Unknown payment intent: ${paymentIntent.id}`);
    return;
  }
  
  // Update status to AUTHORIZED
  await db.paymentIntents.update(intent.id, {
    status: 'AUTHORIZED',
    authorized_at: new Date()
  });
  
  // Queue the job if it was waiting for payment
  if (intent.job_id) {
    const job = await db.jobs.findOne({ id: intent.job_id });
    if (job && job.status === 'DRAFTED') {
      await db.jobs.update(intent.job_id, { status: 'QUEUED' });
      await emitEvent(intent.job_id, 'PAYMENT_AUTHORIZED', {
        amount: intent.amount_cents
      });
    }
  }
}

async function handleDisputeCreated(dispute: Stripe.Dispute) {
  const charge = dispute.charge as string;
  
  const intent = await db.paymentIntents.findOne({
    provider_charge_id: charge
  });
  
  if (!intent) {
    console.error(`Unknown charge in dispute: ${charge}`);
    return;
  }
  
  // Update payment status
  await db.paymentIntents.update(intent.id, {
    status: 'DISPUTED',
    metadata: {
      ...intent.metadata,
      dispute_id: dispute.id,
      dispute_reason: dispute.reason,
      dispute_amount: dispute.amount
    }
  });
  
  // Update job billing status
  if (intent.job_id) {
    await db.jobs.update(intent.job_id, {
      billing_status: 'DISPUTED'
    });
    
    await emitEvent(intent.job_id, 'BILLING_DISPUTED', {
      dispute_id: dispute.id,
      reason: dispute.reason
    });
  }
  
  // Alert operations team
  await alertOps('PAYMENT_DISPUTE', {
    dispute_id: dispute.id,
    job_id: intent.job_id,
    amount: dispute.amount,
    reason: dispute.reason
  });
}
```

### 5.2 Webhook Events Table

```sql
CREATE TABLE webhook_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL,                -- 'stripe', 'iyzico'
  event_id      TEXT NOT NULL,                -- Provider's event ID
  event_type    TEXT NOT NULL,                -- Event type
  payload       JSONB NOT NULL,               -- Full event payload
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE (provider, event_id)
);

CREATE INDEX idx_webhook_events_provider ON webhook_events (provider, event_type, processed_at DESC);
```

---

## 6. Billing Automation

> **Scope:** [MVP REQUIRED]

### 6.1 Auto-Capture on Completion

```typescript
// services/billing/auto-capture.ts

// Called when job reaches COMPLETED
export async function handleJobCompleted(jobId: string): Promise<void> {
  const job = await db.jobs.findOne({ id: jobId });
  
  if (!job || job.status !== 'COMPLETED') {
    throw new Error('Job not in COMPLETED status');
  }
  
  // Check evidence is sealed
  const evidence = await db.evidencePacks.findOne({
    job_id: jobId,
    status: 'SEALED'
  });
  
  if (!evidence) {
    throw new Error('Evidence pack not sealed');
  }
  
  // Get payment intent
  const intent = await db.paymentIntents.findOne({
    job_id: jobId,
    status: 'AUTHORIZED'
  });
  
  if (!intent) {
    console.log(`No authorized payment for job ${jobId} (might be invoice model)`);
    return;
  }
  
  // Capture payment
  if (intent.provider === 'stripe') {
    await stripeService.capturePayment(jobId);
  }
  // Note: Iyzico captures immediately, no separate capture needed
  
  // Update job billing status
  await db.jobs.update(jobId, {
    billing_status: 'BILLED',
    billed_at: new Date(),
    billing_ref: intent.provider_charge_id
  });
  
  // Emit billing event
  await emitEvent(jobId, 'BILLED', {
    billing_ref: intent.provider_charge_id,
    amount: intent.amount_cents,
    currency: intent.currency
  });
  
  // Send receipt notification
  await notificationService.sendReceipt(job.tenant_id, {
    job_id: jobId,
    amount: intent.amount_cents,
    currency: intent.currency,
    evidence_pack_url: `${process.env.PORTAL_URL}/evidence/${jobId}`
  });
}
```

### 6.2 Auto-Cancel on Failure

```typescript
// Called when job reaches FAILED_TERMINAL
export async function handleJobFailed(jobId: string): Promise<void> {
  const job = await db.jobs.findOne({ id: jobId });
  
  const intent = await db.paymentIntents.findOne({
    job_id: jobId,
    status: 'AUTHORIZED'
  });
  
  if (!intent) return; // No payment to cancel
  
  // Cancel authorization
  if (intent.provider === 'stripe') {
    await stripeService.cancelAuthorization(jobId);
  }
  
  // Notify customer
  await notificationService.sendPaymentCancelled(job.tenant_id, {
    job_id: jobId,
    reason: 'Job processing failed - no charge'
  });
}
```

### 6.3 Monthly Invoice Generation (Model C)

```typescript
// jobs/generate-invoices.ts
// Runs on 1st of each month

export async function generateMonthlyInvoices(): Promise<void> {
  const lastMonth = subMonths(new Date(), 1);
  const periodStart = startOfMonth(lastMonth);
  const periodEnd = endOfMonth(lastMonth);
  
  // Get all tenants with completed jobs
  const tenants = await db.query(`
    SELECT DISTINCT tenant_id 
    FROM jobs 
    WHERE status = 'COMPLETED'
      AND billing_status = 'ELIGIBLE'
      AND billed_at IS NULL
      AND completed_at BETWEEN $1 AND $2
  `, [periodStart, periodEnd]);
  
  for (const { tenant_id } of tenants) {
    await generateInvoiceForTenant(tenant_id, periodStart, periodEnd);
  }
}

async function generateInvoiceForTenant(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<void> {
  // Get unbilled completed jobs
  const jobs = await db.jobs.findMany({
    tenant_id: tenantId,
    status: 'COMPLETED',
    billing_status: 'ELIGIBLE',
    billed_at: null,
    completed_at: { gte: periodStart, lte: periodEnd }
  });
  
  if (jobs.length === 0) return;
  
  // Calculate totals
  const lineItems = jobs.map(job => ({
    job_id: job.id,
    description: `Visa application - ${job.reference}`,
    quantity: 1,
    unit_price_cents: getPriceForJobType(job.visa_type),
    total_cents: getPriceForJobType(job.visa_type)
  }));
  
  const subtotal = lineItems.reduce((sum, item) => sum + item.total_cents, 0);
  const tax = calculateTax(tenantId, subtotal);
  const total = subtotal + tax;
  
  // Generate invoice number
  const invoiceNumber = await generateInvoiceNumber();
  
  // Create invoice
  const invoice = await db.transaction(async (tx) => {
    const inv = await tx.invoices.insert({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      period_start: periodStart,
      period_end: periodEnd,
      subtotal_cents: subtotal,
      tax_cents: tax,
      total_cents: total,
      currency: 'USD',
      status: 'DRAFT',
      due_date: addDays(new Date(), 30)
    });
    
    // Create line items
    for (const item of lineItems) {
      await tx.invoiceLineItems.insert({
        invoice_id: inv.id,
        ...item
      });
    }
    
    // Mark jobs as invoiced
    for (const job of jobs) {
      await tx.jobs.update(job.id, {
        billing_status: 'BILLED',
        billing_ref: invoiceNumber
      });
    }
    
    return inv;
  });
  
  // Generate PDF
  const pdfBuffer = await generateInvoicePdf(invoice, lineItems);
  const pdfPath = await uploadInvoicePdf(tenantId, invoice.id, pdfBuffer);
  
  await db.invoices.update(invoice.id, {
    pdf_storage_ref: pdfPath,
    status: 'SENT',
    sent_at: new Date()
  });
  
  // Send invoice notification
  await notificationService.sendInvoice(tenantId, {
    invoice_number: invoiceNumber,
    total: total,
    due_date: invoice.due_date,
    pdf_url: `${process.env.PORTAL_URL}/invoices/${invoice.id}/pdf`
  });
}
```

---

## 7. Dispute Handling

> **Scope:** [OPS]

### 7.1 Dispute Workflow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    DISPUTE RESOLUTION WORKFLOW                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  DISPUTE RECEIVED (Stripe webhook or customer complaint)                         │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  1. AUTOMATIC RESPONSE (within 1 hour)                                  │    │
│  │     • Mark job billing_status = DISPUTED                                │    │
│  │     • Retrieve sealed evidence pack                                     │    │
│  │     • Generate dispute response document                                │    │
│  │     • Submit to payment provider                                        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ▼                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  2. EVIDENCE SUBMISSION                                                 │    │
│  │     • Screenshot of confirmation page                                   │    │
│  │     • FSM timeline showing job completion                               │    │
│  │     • Confirmation number from target site                              │    │
│  │     • Manifest hash proving authenticity                                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                          │
│       ├── Dispute won → billing_status = BILLED                                  │
│       │                                                                          │
│       └── Dispute lost → billing_status = REFUNDED                               │
│                        → Record loss for analysis                                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Auto-Respond to Disputes

```typescript
// services/billing/disputes.ts

export async function handleDispute(disputeId: string): Promise<void> {
  const intent = await db.paymentIntents.findOne({
    'metadata.dispute_id': disputeId
  });
  
  if (!intent || !intent.job_id) {
    throw new Error('Cannot find job for dispute');
  }
  
  // Get evidence pack
  const evidence = await db.evidencePacks.findOne({
    job_id: intent.job_id,
    status: 'SEALED'
  });
  
  if (!evidence) {
    // No evidence = we lose
    console.error(`No evidence for disputed job ${intent.job_id}`);
    return;
  }
  
  // Download evidence pack
  const packBuffer = await downloadFromS3(evidence.storage_ref);
  
  // Extract confirmation screenshot
  const zip = await unzipper.Open.buffer(packBuffer);
  const screenshot = await zip.files
    .find(f => f.path === 'screenshot_final.png')
    ?.buffer();
  
  // Submit evidence to Stripe
  await stripe.disputes.update(disputeId, {
    evidence: {
      product_description: 'Visa application processing service',
      customer_purchase_ip: intent.metadata.customer_ip,
      receipt: evidence.manifest_hash,
      uncategorized_file: screenshot,
      uncategorized_text: `
        Job completed successfully on ${evidence.sealed_at}.
        Confirmation visible in attached screenshot.
        Evidence pack hash: ${evidence.manifest_hash}
        Evidence pack can be independently verified.
      `
    },
    submit: true
  });
  
  // Log submission
  await emitEvent(intent.job_id, 'DISPUTE_EVIDENCE_SUBMITTED', {
    dispute_id: disputeId,
    evidence_hash: evidence.manifest_hash
  });
}
```

---

## 8. Reconciliation

> **Scope:** [OPS]

### 8.1 Daily Reconciliation Job

```typescript
// jobs/reconcile-payments.ts
// Runs daily at 02:00 UTC

export async function reconcilePayments(): Promise<void> {
  const yesterday = subDays(new Date(), 1);
  
  // 1. Find authorized intents older than 7 days (auth expiring)
  const expiringAuths = await db.paymentIntents.findMany({
    status: 'AUTHORIZED',
    authorized_at: { lt: subDays(new Date(), 6) }
  });
  
  for (const intent of expiringAuths) {
    await alertOps('AUTH_EXPIRING', {
      job_id: intent.job_id,
      authorized_at: intent.authorized_at,
      days_remaining: 1
    });
  }
  
  // 2. Find completed jobs without captured payment
  const unbilledCompleted = await db.query(`
    SELECT j.id, j.completed_at, pi.status as payment_status
    FROM jobs j
    LEFT JOIN payment_intents pi ON pi.job_id = j.id
    WHERE j.status = 'COMPLETED'
      AND j.billing_status != 'BILLED'
      AND j.completed_at < $1
  `, [subHours(new Date(), 1)]);
  
  for (const job of unbilledCompleted) {
    await alertOps('UNBILLED_COMPLETED_JOB', {
      job_id: job.id,
      completed_at: job.completed_at,
      payment_status: job.payment_status
    });
  }
  
  // 3. Sync with Stripe (verify our records match)
  const recentCaptures = await db.paymentIntents.findMany({
    status: 'CAPTURED',
    captured_at: { gte: yesterday }
  });
  
  for (const intent of recentCaptures) {
    if (intent.provider === 'stripe') {
      const stripeIntent = await stripe.paymentIntents.retrieve(
        intent.provider_intent_id
      );
      
      if (stripeIntent.status !== 'succeeded') {
        await alertOps('PAYMENT_STATUS_MISMATCH', {
          job_id: intent.job_id,
          our_status: 'CAPTURED',
          stripe_status: stripeIntent.status
        });
      }
    }
  }
}
```

### 8.2 Reconciliation Report

```sql
-- Daily reconciliation query
SELECT 
  DATE(created_at) as date,
  COUNT(*) FILTER (WHERE status = 'CAPTURED') as captured,
  COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled,
  COUNT(*) FILTER (WHERE status = 'REFUNDED') as refunded,
  COUNT(*) FILTER (WHERE status = 'DISPUTED') as disputed,
  SUM(amount_cents) FILTER (WHERE status = 'CAPTURED') as captured_amount,
  SUM(amount_cents) FILTER (WHERE status = 'REFUNDED') as refunded_amount
FROM payment_intents
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;
```


---

## MVP Simplification (Internal Payments Mode) [MVP REQUIRED]

If the company processes payments **manually with its own cards** (no customer portal billing yet):

Required:
- record payment reference
- mark job as BILLED on success
- no customer charge/refund logic
- no gateway webhooks needed

Deferred:
- Stripe/Iyzico flows
- disputes
- invoices
- automated refunds

These sections remain for future SaaS/customer billing rollout.

---
