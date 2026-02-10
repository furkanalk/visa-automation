# Email Notifications

## Overview

Email notifications provide formal records and summaries of visa automation events, complementing the real-time Telegram notifications.

## Architecture

### Notification Channels

1. **Telegram** - Real-time event stream (slot open/closed, immediate alerts)
2. **Email** - Summary and official records (slot found + booking/confirmation details)

### Email Transport

The system uses **SMTP** (Simple Mail Transfer Protocol) as the email delivery mechanism:
- ✅ **Modular**: No external dependencies on third-party services
- ✅ **Self-contained**: Works with any SMTP server (Gmail, Outlook, SendGrid, Postmark, self-hosted)
- ✅ **Portable**: Can be migrated to a separate NOTIFICATIONS queue/consumer later if needed

## Implementation

### 1. Email Module (`email.ts`)

Location: `apps/worker/src/core/notify/email.ts`

**Functions:**

#### `sendEmail(args)`
Sends an email via configured SMTP server.

**Parameters:**
```typescript
{
  to: string;       // Recipient email
  subject: string;  // Email subject
  html: string;     // HTML body
  text?: string;    // Plain text alternative (optional)
}
```

**Environment Variables Required:**
- `SMTP_HOST` - SMTP server hostname
- `SMTP_PORT` - SMTP server port (587 for TLS, 465 for SSL)
- `SMTP_USER` - SMTP authentication username
- `SMTP_PASS` - SMTP authentication password
- `SMTP_FROM` - Sender address (e.g., "Visa Automation <no-reply@yourdomain.com>")

#### `resolveRecipient(applicantEmail)`
Determines the email recipient with fallback logic.

**Logic:**
1. Use `applicant_data.email` if present and valid
2. Fall back to `EMAIL_FALLBACK_TO` env var if applicant email missing
3. Throw error if both are missing

### 2. Email Trigger Points

#### Slot Found Event
**File:** `apps/worker/src/portals/as-visa/fsm/handlers.ts`

**Flow:**
1. Slot detected by `slotHunt()`
2. Send Telegram notification (instant alert)
3. Send email notification (formal record)
4. Halt FSM with `SLOT_FOUND` state

**Email Content:**
- Job ID
- Portal ID
- Tenant ID
- Timestamp
- Available dates (up to 20)
- Portal base URL

## Configuration

### Environment Variables

Add to `.env`:

```bash
# ===========================================
# Email Notifications (SMTP)
# ===========================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="Visa Automation <no-reply@yourdomain.com>"
EMAIL_FALLBACK_TO=admin@yourdomain.com
```

### SMTP Provider Examples

#### Gmail
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password  # Generate at https://myaccount.google.com/apppasswords
```

#### Outlook/Office 365
```bash
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password
```

#### SendGrid
```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

#### Postmark
```bash
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=your-postmark-server-token
SMTP_PASS=your-postmark-server-token
```

## Email Template

### Slot Found Email

**Subject:** `[VISA] Slot OPEN — job {jobId}`

**HTML Body:**
```html
<p><b>Slot open</b></p>
<ul>
  <li>job: <code>{jobId}</code></li>
  <li>portal: <code>{portalId}</code></li>
  <li>tenant: <code>{tenantId}</code></li>
  <li>time: <code>{timestamp}</code></li>
  <li>dates: <code>{date1, date2, ...}</code></li>
</ul>
<p>URL: {portalBaseUrl}</p>
```

## Error Handling

### Missing Environment Variables
- **Error:** `Missing env: SMTP_HOST` (or other SMTP_* vars)
- **Solution:** Configure all required SMTP environment variables

### Missing Recipient
- **Error:** `No recipient: applicant_data.email empty and EMAIL_FALLBACK_TO missing`
- **Solution:** 
  - Ensure `applicant_data.email` is provided when creating jobs, OR
  - Set `EMAIL_FALLBACK_TO` in environment variables

### SMTP Connection Errors
- **Error:** `Connection timeout`, `Authentication failed`, etc.
- **Solution:**
  - Verify SMTP host/port are correct
  - Check credentials (username/password)
  - For Gmail: Enable 2FA and generate app password
  - Check firewall rules (port 587/465 must be open)

## Testing

### 1. Configure SMTP
Add valid SMTP credentials to `.env`:
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-test-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="Visa Test <no-reply@test.com>"
EMAIL_FALLBACK_TO=your-test-email@gmail.com
```

### 2. Create Test Job with Email
```bash
curl -X POST http://localhost:8000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "test-tenant",
    "portal_id": "as-visa",
    "payload": {
      "applicant_data": {
        "email": "recipient@example.com"
      }
    }
  }'
```

### 3. Verify Email Delivery
- Check inbox of `recipient@example.com`
- If applicant email missing, check `EMAIL_FALLBACK_TO` inbox
- Verify email contains job details, dates, and portal URL

### 4. Test Email Sending Directly
Create a test script:
```typescript
import { sendEmail, resolveRecipient } from './apps/worker/src/core/notify/email.js';

await sendEmail({
  to: 'test@example.com',
  subject: 'Test Email',
  html: '<p>This is a test email from Visa Automation</p>',
});
```

## Future Enhancements

### Separate Notifications Service
Current: Email sent synchronously in worker

**Future Option:** Move to async queue pattern
```
┌────────┐      ┌──────────────┐      ┌─────────────────┐
│ Worker │─────>│ NOTIFICATIONS│─────>│ Notification    │
│        │      │ Queue (Redis)│      │ Consumer Service│
└────────┘      └──────────────┘      └─────────────────┘
                                              │
                                              ├─> Send Email
                                              ├─> Send Telegram
                                              └─> Send SMS
```

**Benefits:**
- Decouples notification delivery from job processing
- Retry logic for failed sends
- Rate limiting across all channels
- Centralized notification logging
- Can add more channels (SMS, Slack, webhooks) without changing worker

### Rich Email Templates
- HTML templates with branding
- Inline CSS styling
- Embedded images/logos
- Action buttons (similar to Telegram)

### Email Preferences
- Per-tenant notification settings
- Opt-in/opt-out per email type
- Digest emails (daily/weekly summaries)

### Email Events
- Booking confirmation
- Payment receipt
- Appointment reminder
- Status change notifications

## Performance

### Current Impact
- **Latency:** ~500-2000ms per email (SMTP send time)
- **Blocking:** Email sent synchronously in slot found handler
- **Failure Mode:** If SMTP fails, error logged but job continues

### Optimization Strategies
1. **Fire and forget:** Wrap `sendEmail()` in `Promise.resolve().then()` to avoid blocking
2. **Queue-based:** Move to BullMQ NOTIFICATIONS queue (future enhancement)
3. **Batch sending:** Collect multiple events and send digest emails
4. **Async transport:** Use nodemailer's stream transport for large volumes

## Security

### SMTP Credentials
- Store in environment variables (never commit to git)
- Use app-specific passwords (not main account password)
- Rotate credentials periodically
- Use different credentials per environment (dev/staging/prod)

### Email Content
- Sanitize user input before including in emails
- Avoid exposing sensitive data in email bodies
- Use HTTPS links only
- Consider encrypted email for sensitive information

## Monitoring

### Metrics to Track
- Email send success rate
- Email delivery time (latency)
- SMTP connection failures
- Bounce rate
- Open rate (if tracking pixels enabled)

### Logging
Current implementation logs:
- Email recipient resolution
- SMTP connection attempts
- Send success/failure

Add to worker logs:
```typescript
ctx.logger.info({ to, subject, jobId }, 'Email sent successfully');
ctx.logger.error({ to, subject, error }, 'Email send failed');
```

## Troubleshooting

### Email Not Received

1. **Check spam folder** - Emails from new domains often land in spam
2. **Verify SMTP logs** - Check worker logs for send confirmation
3. **Test SMTP credentials** - Use `nodemailer` test script
4. **Check recipient address** - Verify `applicant_data.email` or `EMAIL_FALLBACK_TO`

### Authentication Failed

1. **Gmail:** Enable 2FA and generate app password
2. **Outlook:** May need to enable "less secure apps"
3. **SendGrid/Postmark:** Verify API key is valid

### Connection Timeout

1. Check firewall allows outbound connections to SMTP port
2. Verify SMTP host/port are correct
3. Try alternative port (587 vs 465)
4. Check if VPN/proxy is blocking SMTP traffic

## Summary

✅ **Implemented:**
- SMTP-based email sending module
- Slot found email notification
- Recipient resolution with fallback
- Environment configuration

🎯 **Ready for:**
- Production deployment with SMTP credentials
- Testing with real job runs
- Monitoring email delivery

🚀 **Future Ready:**
- Can migrate to queue-based architecture
- Can add more email event types
- Can enhance templates and styling
