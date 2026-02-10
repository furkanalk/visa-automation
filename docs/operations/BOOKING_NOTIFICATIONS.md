# Booking Confirmation Notifications

## Overview

When a visa appointment is successfully booked, the system sends notifications through both Telegram and Email channels with different levels of detail:

- **Telegram** - Light notification (instant alert)
- **Email** - Heavy notification (formal record with full details)

This follows the established pattern: Telegram for real-time awareness, Email for comprehensive documentation.

## Architecture

```
Job COMPLETED
    ↓
notifyBookingConfirmed()
    ├─ Dedupe (24h TTL)
    ├─ Telegram (light)
    │   • Job ID
    │   • Portal
    │   • Confirmation number
    │   • URL
    └─ Email (heavy)
        • Job metadata
        • Confirmation number
        • Timestamp
        • Full details JSON
        • Portal URL
```

## Components

### 1. Booking Confirmed Template

**File:** `apps/worker/src/core/notify/templates/booking-confirmed.ts`

**Function:** `renderBookingConfirmedEmail()`

**Returns:**
```typescript
{
  subject: string;  // "[VISA] BOOKED ✅ — job {jobId}"
  html: string;     // Rich HTML with metadata + JSON details
  text: string;     // Plain text alternative
}
```

**Email Content:**
- ✅ Appointment booked header
- Job metadata (job ID, portal, tenant, timestamp)
- Confirmation number (highlighted)
- Portal URL
- Optional details object (formatted JSON)

**Example Output:**

```
Subject: [VISA] BOOKED ✅ — job abc-123

HTML Body:
✅ Appointment booked
• job: abc-123
• portal: as-visa
• tenant: tenant-1
• time: 2026-02-10T14:30:00.000Z
• confirmation: XYZ-12345

URL: https://portal.example.com

<pre>
{
  "appointmentDate": "2026-03-15",
  "appointmentTime": "14:30",
  "location": "Consulate General"
}
</pre>
```

**HTML Escaping:**
- Uses custom `escapeHtml()` function
- Prevents XSS in details JSON
- Safe to include user-generated content

### 2. Email Channel Updates

**File:** `apps/worker/src/core/notify/email.ts`

**Changes:**

#### Enhanced Recipient Resolution

```typescript
export function resolveRecipient(applicantEmail?: unknown): string {
  // 1. Check for ops override (testing/debugging)
  const override = optEnv('NOTIFY_EMAIL_TO');
  if (override) return override;

  // 2. Use applicant email if valid
  if (typeof applicantEmail === 'string' && applicantEmail.includes('@')) {
    return applicantEmail;
  }

  // 3. Fallback to ops inbox
  return mustEnv('SMTP_FALLBACK_TO');
}
```

**Priority Order:**
1. `NOTIFY_EMAIL_TO` - Override for testing/debugging
2. `applicant_data.email` - From job payload
3. `SMTP_FALLBACK_TO` - Ops inbox (required)

**Use Cases:**
- **Development:** Set `NOTIFY_EMAIL_TO=dev@test.com` to capture all emails
- **Production:** Remove `NOTIFY_EMAIL_TO`, use applicant email or fallback
- **Testing:** Override without changing job payloads

#### Flexible SMTP Auth

```typescript
const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: user && pass ? { user, pass } : undefined,
});
```

**Changes:**
- `SMTP_USER` and `SMTP_PASS` are now optional
- Allows SMTP servers without authentication (dev/test)
- Auth object only included if both user and pass are provided

### 3. Orchestrator Function

**File:** `apps/worker/src/core/notify/index.ts`

**Function:** `notifyBookingConfirmed()`

**Parameters:**
```typescript
{
  jobId: string;
  portalId: string;
  tenantId: string;
  baseUrl: string;
  confirmationNumber: string;
  details?: Record<string, unknown>;  // Optional metadata
  payload?: JobQueuePayload;          // For email resolution
  logger: Logger;
}
```

**Deduplication:**
- Key: `notify:booked:{jobId}:{confirmationNumber}`
- TTL: 24 hours
- Rationale: Prevent duplicate booking notifications for same confirmation

**Flow:**
1. Check dedupe (skip if already notified)
2. Send Telegram notification (light)
3. Resolve email recipient
4. Render email template
5. Send email notification (heavy)

**Telegram Message (Light):**
```
✅ BOOKED
• job: abc-123
• portal: as-visa
• confirmation: XYZ-12345
• url: https://portal.example.com
```

**Email (Heavy):**
- Full HTML with all metadata
- Confirmation number prominent
- Details JSON (if provided)
- Timestamp
- Portal URL

### 4. Processor Integration

**File:** `apps/worker/src/processor.ts`

**When:** Job reaches `COMPLETED` state with `confirmationNumber`

**Code:**
```typescript
logger.info({ jobId: job_id, confirmationNumber: result.confirmationNumber }, 'Job completed');

try {
  if (result.confirmationNumber) {
    await notifyBookingConfirmed({
      jobId: job_id,
      portalId: portalConfig.portalId,
      tenantId: tenant_id,
      baseUrl: portalConfig.baseUrl,
      confirmationNumber: result.confirmationNumber,
      details: (result as any).meta ?? undefined,
      payload,
      logger,
    });
  }
} catch (e) {
  logger.error({ jobId: job_id, err: e }, 'Booking notification failed');
}
```

**Error Handling:**
- Wrapped in try-catch
- Logs error but doesn't fail job
- Job is already marked COMPLETED
- Notification failure doesn't affect job status

## Configuration

### Environment Variables

**Required:**
```bash
# SMTP Server
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM="Visa Automation <no-reply@yourdomain.com>"

# Fallback (required)
SMTP_FALLBACK_TO=ops@yourdomain.com

# Telegram (required)
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_IDS=123456,789012
```

**Optional:**
```bash
# SMTP Auth (optional for dev/test)
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Email Override (testing)
NOTIFY_EMAIL_TO=dev@test.com
```

### SMTP Configuration Examples

#### Gmail (with auth)
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password  # Generate at myaccount.google.com/apppasswords
SMTP_FROM="Visa Automation <your-email@gmail.com>"
SMTP_FALLBACK_TO=admin@yourdomain.com
```

#### Mailgun
```bash
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@yourdomain.com
SMTP_PASS=your-mailgun-password
SMTP_FROM="Visa Automation <no-reply@yourdomain.com>"
SMTP_FALLBACK_TO=admin@yourdomain.com
```

#### Local Development (no auth)
```bash
SMTP_HOST=localhost
SMTP_PORT=1025
# SMTP_USER= (not needed)
# SMTP_PASS= (not needed)
SMTP_FROM="Visa Dev <dev@localhost>"
SMTP_FALLBACK_TO=dev@localhost
NOTIFY_EMAIL_TO=dev@localhost  # Capture all emails
```

## Testing

### 1. Local SMTP Server (MailHog)

**Start MailHog:**
```bash
docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog
```

**Configure:**
```bash
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM="Visa Test <test@localhost>"
SMTP_FALLBACK_TO=test@localhost
NOTIFY_EMAIL_TO=test@localhost
```

**View emails:** http://localhost:8025

### 2. Test with Mock Job

**Create a completed job:**
```typescript
// In your test or manually via API
const result = await runFSM({
  // ... FSM context
});

// Mock completion
const mockResult = {
  lastState: JOB_STATES.COMPLETED,
  confirmationNumber: 'TEST-12345',
  meta: {
    appointmentDate: '2026-03-15',
    appointmentTime: '14:30',
    location: 'Test Consulate',
  },
};

await notifyBookingConfirmed({
  jobId: 'test-job-123',
  portalId: 'as-visa',
  tenantId: 'test-tenant',
  baseUrl: 'https://portal.test.com',
  confirmationNumber: mockResult.confirmationNumber,
  details: mockResult.meta,
  payload: { /* test payload */ },
  logger: console as any,
});
```

### 3. Email Override Testing

**Scenario:** Test without changing job payloads

```bash
# Set override in .env
NOTIFY_EMAIL_TO=developer@company.com

# All booking emails will go to developer@company.com
# Regardless of applicant_data.email in job payload
```

**Verify:**
1. Create job with applicant email: `user@example.com`
2. Job completes successfully
3. Email is sent to: `developer@company.com` (not user@example.com)

**Production:**
```bash
# Remove or comment out override
# NOTIFY_EMAIL_TO=

# Emails will use applicant_data.email or SMTP_FALLBACK_TO
```

## Scenarios

### Scenario 1: Happy Path

**Setup:**
- Applicant email: `applicant@example.com`
- No override set

**Result:**
- Telegram: Sent to configured chat IDs
- Email: Sent to `applicant@example.com`

### Scenario 2: Missing Applicant Email

**Setup:**
- Applicant email: Not provided or invalid
- Fallback: `ops@company.com`

**Result:**
- Telegram: Sent to configured chat IDs
- Email: Sent to `ops@company.com`

### Scenario 3: Development Override

**Setup:**
- Override: `NOTIFY_EMAIL_TO=dev@test.com`
- Applicant email: `applicant@example.com`

**Result:**
- Telegram: Sent to configured chat IDs
- Email: Sent to `dev@test.com` (override takes precedence)

### Scenario 4: Duplicate Booking

**Setup:**
- Job completes with confirmation: `XYZ-123`
- Notification sent successfully
- Job somehow completes again (retry/error)

**Result:**
- First attempt: Notifications sent
- Second attempt (within 24h): Deduped, no notifications

### Scenario 5: Notification Failure

**Setup:**
- SMTP server unreachable
- Job completes successfully

**Result:**
- Job marked as COMPLETED ✅
- Notification error logged ❌
- Job processing continues
- Manual retry possible via notification API

## Deduplication

### Key Structure

```
notify:booked:{jobId}:{confirmationNumber}
```

### TTL: 24 hours

**Rationale:**
- Booking confirmation is a one-time event
- 24h window prevents duplicate notifications from retries
- Long enough to cover any system issues
- Short enough to allow re-notification if needed

### Scenarios

| Time | Event | Deduped? |
|------|-------|----------|
| T+0 | First booking completion | ❌ No (sent) |
| T+1h | Retry/duplicate | ✅ Yes (skipped) |
| T+12h | Another retry | ✅ Yes (skipped) |
| T+25h | Expired, new attempt | ❌ No (sent) |

## Error Handling

### Philosophy: Log but Don't Fail

**Reason:** Job is already COMPLETED, notification is secondary.

**Implementation:**
```typescript
try {
  if (result.confirmationNumber) {
    await notifyBookingConfirmed({ ... });
  }
} catch (e) {
  logger.error({ jobId: job_id, err: e }, 'Booking notification failed');
  // Job continues, no throw
}
```

### Common Errors

#### SMTP Connection Failed
```
Error: connect ECONNREFUSED 127.0.0.1:587
```
**Solution:**
- Check SMTP_HOST and SMTP_PORT
- Verify SMTP server is running
- Check firewall rules

#### Authentication Failed
```
Error: Invalid login: 535 Authentication failed
```
**Solution:**
- Verify SMTP_USER and SMTP_PASS
- For Gmail: Enable 2FA and use app password
- Check credentials are not expired

#### Missing Environment Variable
```
Error: Missing env: SMTP_HOST
```
**Solution:**
- Add required env var to .env
- Restart worker service

#### No Recipient
```
Error: Missing env: SMTP_FALLBACK_TO
```
**Solution:**
- Set SMTP_FALLBACK_TO in .env
- Or provide applicant_data.email in job payload

## Performance

### Latency Breakdown

| Operation | Time | Notes |
|-----------|------|-------|
| Dedupe check | 2-3ms | Redis GET + SET |
| Template render | <1ms | String concatenation |
| Telegram send | 100-500ms | HTTP POST |
| Email send | 500-2000ms | SMTP handshake + send |
| **Total** | **~600-2500ms** | Depends on network |

### Optimization

#### Parallel Sending
```typescript
// Current: Sequential
await telegramSendMessage({ ... });
await sendEmail({ ... });

// Optimized: Parallel
await Promise.all([
  telegramSendMessage({ ... }),
  sendEmail({ ... }),
]);
```

**Benefit:** Reduce total time to max(telegram, email) instead of sum.

#### Fire and Forget
```typescript
// Don't block job completion on notifications
Promise.resolve()
  .then(() => notifyBookingConfirmed({ ... }))
  .catch(err => logger.error({ err }, 'Notification failed'));
```

**Trade-off:** No error handling, but faster job completion.

## Monitoring

### Metrics to Track

1. **Notification success rate**
   - Target: >99%
   - Alert if <95%

2. **Notification latency**
   - Target: <2s p95
   - Alert if >5s p95

3. **Dedupe hit rate**
   - Expected: <1% (few duplicates)
   - Alert if >10% (indicates retry issues)

4. **Email delivery rate**
   - Track bounces/failures
   - Alert on high bounce rate

### Logging

**Success:**
```json
{
  "level": "info",
  "jobId": "abc-123",
  "confirmationNumber": "XYZ-12345",
  "msg": "Booking notification sent"
}
```

**Failure:**
```json
{
  "level": "error",
  "jobId": "abc-123",
  "err": { "message": "SMTP connection failed", ... },
  "msg": "Booking notification failed"
}
```

**Dedupe:**
```json
{
  "level": "debug",
  "jobId": "abc-123",
  "msg": "notifyBookingConfirmed deduped"
}
```

## Future Enhancements

### 1. Notification Queue

**Current:** Synchronous in processor

**Future:** Async queue
```typescript
// Processor
await notificationQueue.add('booking-confirmed', {
  jobId,
  confirmationNumber,
  ...
});

// Separate consumer
worker.on('booking-confirmed', async (job) => {
  await notifyBookingConfirmed(job.data);
});
```

**Benefits:**
- Decoupled from job processing
- Retry logic built-in
- Rate limiting
- Priority queues

### 2. Rich Email Templates

**Current:** Simple HTML strings

**Future:** Handlebars/EJS templates
```handlebars
<!-- templates/booking-confirmed.hbs -->
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial; }
    .header { background: #4CAF50; color: white; padding: 20px; }
    .details { padding: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>✅ Appointment Confirmed</h1>
  </div>
  <div class="details">
    <p>Confirmation: <strong>{{confirmationNumber}}</strong></p>
    {{#if details.appointmentDate}}
      <p>Date: {{details.appointmentDate}}</p>
    {{/if}}
  </div>
</body>
</html>
```

### 3. Calendar Invite (ICS)

**Add to email:**
```typescript
const ics = generateCalendarInvite({
  summary: 'Visa Appointment',
  description: `Confirmation: ${confirmationNumber}`,
  start: appointmentDateTime,
  location: 'Consulate General',
});

await sendEmail({
  to,
  subject,
  html,
  attachments: [{
    filename: 'appointment.ics',
    content: ics,
  }],
});
```

### 4. SMS Notification

**Add SMS channel:**
```typescript
// Light notification for booking
await sendSMS({
  to: resolvePhoneNumber(payload?.applicant_data?.phone),
  message: `Visa appointment booked! Confirmation: ${confirmationNumber}`,
});
```

## Summary

✅ **Implemented:**
- Booking confirmation template (email-heavy)
- notifyBookingConfirmed() orchestrator
- Telegram notification (light)
- Email notification (heavy with details JSON)
- 24h deduplication
- Flexible recipient resolution (override, applicant, fallback)
- Optional SMTP auth
- Processor integration with error handling

🎯 **Benefits:**
- Formal record of booking via email
- Instant awareness via Telegram
- Prevents duplicate notifications
- Safe error handling (doesn't fail job)
- Easy testing with email override
- Works with or without SMTP auth

🚀 **Production Ready:**
- All error cases handled
- Comprehensive logging
- Deduplication prevents spam
- Configurable for dev/staging/prod
