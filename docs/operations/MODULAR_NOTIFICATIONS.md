# Modular Notification Architecture

## Overview

The notification system is now structured with clean separation of concerns:

1. **Templates** - Content generation (subject/body/text)
2. **Channels** - Delivery mechanisms (Telegram/Email)
3. **Orchestration** - Deduplication, fan-out, and coordination

## Architecture

### Layer Structure

```
┌─────────────────────────────────────────────┐
│           Notification Trigger              │
│     (FSM handlers, job lifecycle)           │
└────────────────┬────────────────────────────┘
                 │
                 v
┌─────────────────────────────────────────────┐
│        Notification Orchestrator            │
│        (notifySlotFound, etc.)              │
│                                             │
│  • Deduplication (hash-based)              │
│  • State tracking (open/closed)            │
│  • Multi-channel fan-out                   │
└────────┬────────────────────┬───────────────┘
         │                    │
         v                    v
┌────────────────┐   ┌────────────────┐
│   Templates    │   │   Templates    │
│  (slot-open)   │   │  (slot-open)   │
└────────┬───────┘   └────────┬───────┘
         │                    │
         v                    v
┌────────────────┐   ┌────────────────┐
│   Telegram     │   │     Email      │
│   Channel      │   │    Channel     │
└────────────────┘   └────────────────┘
```

## Components

### 1. Templates (`core/notify/templates/`)

**Purpose:** Generate notification content independent of delivery channel.

**Location:** `apps/worker/src/core/notify/templates/`

#### `slot-open.ts`

Renders email content for slot found events.

```typescript
export function renderSlotOpenEmail(args: {
  jobId: string;
  tenantId: string;
  portalId: string;
  baseUrl: string;
  dates: string[];
  payload?: JobQueuePayload;
}): { subject: string; html: string; text: string }
```

**Returns:**
- `subject` - Email subject line
- `html` - HTML email body with formatting
- `text` - Plain text alternative

**Features:**
- ✅ Shows up to 20 dates
- ✅ Includes job metadata
- ✅ Timestamp in ISO 8601 format
- ✅ Portal URL for quick access
- ✅ Emoji indicators (🟢)

**Example Output:**
```
Subject: [VISA] Slot OPEN — job abc-123

HTML:
🟢 Slot open
• job: abc-123
• portal: as-visa
• tenant: tenant-1
• time: 2026-02-10T12:34:56.789Z
• dates: 2026-03-15, 2026-03-20, ...
URL: https://portal.example.com
```

### 2. Channels (`core/notify/`)

**Purpose:** Handle actual delivery to different platforms.

#### Telegram Channel (`telegram.ts`)

- Real-time push notifications
- Inline action buttons (ACK/STOP)
- Rich formatting (Markdown/HTML)
- Multiple chat support (CSV)

#### Email Channel (`email.ts`)

- SMTP-based delivery
- HTML + plain text
- Recipient resolution with fallback
- Formal record keeping

### 3. Orchestrator (`core/notify/index.ts`)

**Purpose:** Coordinate notification delivery with business logic.

#### `notifySlotFound()`

**Responsibilities:**
1. **Deduplication** - Prevent spam from identical slot data
2. **State tracking** - Mark slot as "open"
3. **Multi-channel delivery** - Send to both Telegram and Email
4. **Error handling** - Log failures, continue execution

**Deduplication Strategy:**

```typescript
// Generate hash of slot dates
const normalized = args.dates.slice().sort().join('|');
const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);

// Dedupe key: notify:slot_open:{jobId}:{hash}
// TTL: 300 seconds (5 minutes)
const ok = await dedupeOnce({ key: `notify:slot_open:${args.jobId}:${hash}`, ttlSeconds: 300 });
```

**Why 5 minutes?**
- Prevents rapid-fire notifications for same slot data
- Short enough to allow quick retry if slots change
- Long enough to absorb polling jitter

**Flow:**
```
1. Generate hash from dates
2. Check Redis: has this hash been seen recently?
   - YES → Skip notification (deduped)
   - NO  → Continue
3. Mark slot as "open" in Redis
4. Send Telegram notification (instant alert)
5. Render email template
6. Send email notification (formal record)
```

#### `notifySlotClosed()`

**Responsibilities:**
1. **Deduplication** - Prevent repeated "closed" messages
2. **Telegram notification** - Inform users slot is no longer available

**Deduplication:**
- Key: `slot_closed:{jobId}`
- TTL: 1800 seconds (30 minutes)
- Rationale: Avoid spam when slots remain closed

## Key Improvements

### Before (Coupled)

❌ Email sending in FSM handler  
❌ Duplicate template logic in handler  
❌ No centralized deduplication  
❌ Hard to add new channels  

```typescript
// handler.ts (before)
await notifySlotFound({ ... });

// Separate email logic
const to = resolveRecipient(...);
await sendEmail({
  to,
  subject: `[VISA] Slot OPEN — job ${jobId}`,
  html: `<p>...</p>`, // Template inline!
});
```

### After (Modular)

✅ Templates separate from channels  
✅ Single notification call handles everything  
✅ Centralized deduplication  
✅ Easy to add SMS/Slack/Webhook  

```typescript
// handler.ts (after)
await notifySlotFound({
  jobId,
  portalId,
  tenantId,
  baseUrl,
  dates,
  payload, // <-- Pass full context
  logger,
});
// Done! Email + Telegram handled internally
```

## Deduplication Details

### Why Hash-Based Dedupe?

**Problem:** Slot polling happens every 30-60 seconds. If same dates are available, we don't want to spam users.

**Solution:** Hash the sorted dates, use as dedupe key.

**Example:**
```
Dates: ["2026-03-20", "2026-03-15", "2026-03-25"]
Sorted: ["2026-03-15", "2026-03-20", "2026-03-25"]
Joined: "2026-03-15|2026-03-20|2026-03-25"
Hash: sha256 → "a3f2e1d9c..." → first 12 chars: "a3f2e1d9c8b7"
Redis Key: "notify:slot_open:job-123:a3f2e1d9c8b7"
TTL: 300 seconds
```

**Scenarios:**

| Scenario | Same Hash? | Notification Sent? |
|----------|------------|--------------------|
| First poll finds slots | N/A | ✅ Yes |
| Second poll, same slots | Yes | ❌ No (deduped) |
| Third poll, different slots | No | ✅ Yes (new hash) |
| Wait 6 minutes, same slots | Yes (expired) | ✅ Yes (TTL expired) |

### Redis Keys

| Key Pattern | Purpose | TTL |
|-------------|---------|-----|
| `notify:slot_open:{jobId}:{hash}` | Dedupe slot found notifications | 300s (5 min) |
| `slot_status:{jobId}` | Track open/closed state | 2 days |
| `slot_closed:{jobId}` | Dedupe slot closed notifications | 1800s (30 min) |

## Adding New Templates

### Example: Booking Confirmation Template

**1. Create template file:**

```typescript
// apps/worker/src/core/notify/templates/booking-confirmed.ts
import type { JobQueuePayload } from '@visa-automation/shared';

export function renderBookingConfirmedEmail(args: {
  jobId: string;
  bookingRef: string;
  appointmentDate: string;
  appointmentTime: string;
  payload?: JobQueuePayload;
}) {
  const subject = `[VISA] Booking Confirmed — ${args.bookingRef}`;

  const html =
    `<p><b>✅ Booking confirmed</b></p>` +
    `<ul>` +
    `<li>Reference: <code>${args.bookingRef}</code></li>` +
    `<li>Date: <code>${args.appointmentDate}</code></li>` +
    `<li>Time: <code>${args.appointmentTime}</code></li>` +
    `</ul>`;

  const text =
    `BOOKING CONFIRMED\n` +
    `Reference: ${args.bookingRef}\n` +
    `Date: ${args.appointmentDate}\n` +
    `Time: ${args.appointmentTime}\n`;

  return { subject, html, text };
}
```

**2. Export from index:**

```typescript
// apps/worker/src/core/notify/templates/index.ts
export { renderSlotOpenEmail } from './slot-open.js';
export { renderBookingConfirmedEmail } from './booking-confirmed.js';
```

**3. Create orchestrator function:**

```typescript
// apps/worker/src/core/notify/index.ts
export async function notifyBookingConfirmed(args: {
  jobId: string;
  bookingRef: string;
  appointmentDate: string;
  appointmentTime: string;
  payload?: JobQueuePayload;
  logger: Logger;
}): Promise<void> {
  // Dedupe check (optional)
  const ok = await dedupeOnce({
    key: `notify:booking:${args.jobId}:${args.bookingRef}`,
    ttlSeconds: 3600,
  });
  if (!ok) return;

  // Telegram
  const token = mustEnv('TELEGRAM_BOT_TOKEN');
  const chatIds = splitCsv(mustEnv('TELEGRAM_CHAT_IDS'));
  await telegramSendMessage({
    token,
    chatIds,
    text: `✅ <b>BOOKING CONFIRMED</b>\nRef: ${args.bookingRef}\nDate: ${args.appointmentDate}`,
    logger: args.logger,
  });

  // Email
  const to = resolveRecipient(args.payload?.applicant_data?.email);
  const email = renderBookingConfirmedEmail(args);
  await sendEmail({ to, subject: email.subject, html: email.html, text: email.text });
}
```

**4. Call from handler:**

```typescript
// In FSM handler or processor
await notifyBookingConfirmed({
  jobId: ctx.jobId,
  bookingRef: 'XYZ-12345',
  appointmentDate: '2026-03-15',
  appointmentTime: '14:30',
  payload: ctx.payload,
  logger: ctx.logger,
});
```

## Adding New Channels

### Example: SMS Channel

**1. Create channel module:**

```typescript
// apps/worker/src/core/notify/sms.ts
import fetch from 'node-fetch';

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export async function sendSMS(args: {
  to: string;
  message: string;
}): Promise<void> {
  const apiKey = mustEnv('SMS_API_KEY');
  const from = mustEnv('SMS_FROM_NUMBER');

  await fetch('https://api.sms-provider.com/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      from,
      to: args.to,
      message: args.message,
    }),
  });
}

export function resolvePhoneNumber(applicantPhone?: unknown): string {
  const phone = typeof applicantPhone === 'string' ? applicantPhone.trim() : '';
  if (phone) return phone;

  const fallback = process.env.SMS_FALLBACK_TO;
  if (!fallback) throw new Error('No phone number available');
  return fallback;
}
```

**2. Update orchestrator:**

```typescript
// apps/worker/src/core/notify/index.ts
import { sendSMS, resolvePhoneNumber } from './sms.js';

export async function notifySlotFound(args: {
  // ...existing args
}): Promise<void> {
  // ...existing dedupe logic

  // Telegram
  await telegramSendMessage({ ... });

  // Email
  const email = renderSlotOpenEmail(args);
  await sendEmail({ ... });

  // SMS (NEW!)
  const phone = resolvePhoneNumber(args.payload?.applicant_data?.phone);
  await sendSMS({
    to: phone,
    message: `VISA: Slot available for job ${args.jobId}. Dates: ${args.dates.slice(0, 3).join(', ')}`,
  });
}
```

**3. Configure environment:**

```bash
# .env
SMS_API_KEY=your-api-key
SMS_FROM_NUMBER=+1234567890
SMS_FALLBACK_TO=+1098765432
```

## Testing

### Unit Test Template

```typescript
// apps/worker/src/core/notify/templates/slot-open.test.ts
import { describe, it, expect } from 'vitest';
import { renderSlotOpenEmail } from './slot-open.js';

describe('renderSlotOpenEmail', () => {
  it('should render subject with job ID', () => {
    const result = renderSlotOpenEmail({
      jobId: 'test-123',
      tenantId: 'tenant-1',
      portalId: 'as-visa',
      baseUrl: 'https://portal.example.com',
      dates: ['2026-03-15', '2026-03-20'],
    });

    expect(result.subject).toBe('[VISA] Slot OPEN — job test-123');
  });

  it('should include dates in HTML', () => {
    const result = renderSlotOpenEmail({
      jobId: 'test-123',
      tenantId: 'tenant-1',
      portalId: 'as-visa',
      baseUrl: 'https://portal.example.com',
      dates: ['2026-03-15', '2026-03-20'],
    });

    expect(result.html).toContain('2026-03-15, 2026-03-20');
  });

  it('should truncate dates to 20', () => {
    const dates = Array.from({ length: 30 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
    const result = renderSlotOpenEmail({
      jobId: 'test-123',
      tenantId: 'tenant-1',
      portalId: 'as-visa',
      baseUrl: 'https://portal.example.com',
      dates,
    });

    const matchCount = (result.html.match(/2026-03-/g) || []).length;
    expect(matchCount).toBeLessThanOrEqual(20);
  });
});
```

### Integration Test

```typescript
// apps/worker/src/core/notify/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifySlotFound } from './index.js';
import * as telegram from './telegram.js';
import * as email from './email.js';
import * as dedupe from './dedupe.js';

vi.mock('./telegram.js');
vi.mock('./email.js');
vi.mock('./dedupe.js');

describe('notifySlotFound', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_IDS = '123,456';
    process.env.NOTIFY_ACTION_BASE_URL = 'http://test.com';
    process.env.NOTIFY_ACTION_SECRET = 'test-secret';
  });

  it('should send both telegram and email', async () => {
    vi.mocked(dedupe.dedupeOnce).mockResolvedValue(true);
    vi.mocked(email.resolveRecipient).mockReturnValue('test@example.com');
    vi.mocked(email.sendEmail).mockResolvedValue();
    vi.mocked(telegram.telegramSendMessage).mockResolvedValue();

    await notifySlotFound({
      jobId: 'test-123',
      portalId: 'as-visa',
      tenantId: 'tenant-1',
      baseUrl: 'https://portal.com',
      dates: ['2026-03-15'],
      logger: console as any,
    });

    expect(telegram.telegramSendMessage).toHaveBeenCalledOnce();
    expect(email.sendEmail).toHaveBeenCalledOnce();
  });

  it('should skip notification if deduped', async () => {
    vi.mocked(dedupe.dedupeOnce).mockResolvedValue(false); // Already sent

    await notifySlotFound({
      jobId: 'test-123',
      portalId: 'as-visa',
      tenantId: 'tenant-1',
      baseUrl: 'https://portal.com',
      dates: ['2026-03-15'],
      logger: console as any,
    });

    expect(telegram.telegramSendMessage).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });
});
```

## Performance

### Latency Breakdown

| Operation | Time | Notes |
|-----------|------|-------|
| Hash generation | <1ms | SHA-256 of sorted dates |
| Redis dedupe check | 2-3ms | Single GET + SETEX |
| Template render | <1ms | String concatenation |
| Telegram send | 100-500ms | HTTP POST to Telegram API |
| Email send (SMTP) | 500-2000ms | SMTP handshake + send |
| **Total** | **~600-2500ms** | Depends on network |

### Optimization Strategies

#### 1. Fire and Forget (Non-blocking)

```typescript
// Don't await email if not critical
Promise.resolve().then(() => sendEmail({ ... })).catch(logger.error);
```

#### 2. Parallel Channel Delivery

```typescript
// Send to all channels in parallel
await Promise.all([
  telegramSendMessage({ ... }),
  sendEmail({ ... }),
  sendSMS({ ... }),
]);
```

#### 3. Queue-Based (Future)

```typescript
// Push to NOTIFICATIONS queue, let consumer handle delivery
await notificationQueue.add('slot-found', {
  jobId,
  dates,
  channels: ['telegram', 'email', 'sms'],
});
```

## Error Handling

### Strategy: Continue on Failure

**Philosophy:** Notification failures should NOT crash the job.

**Implementation:**

```typescript
try {
  await notifySlotFound({ ... });
} catch (err) {
  logger.error({ err, jobId }, 'Notification failed, continuing job');
  // Job continues regardless
}
```

**Monitoring:**
- Log all notification failures
- Track failure rate per channel
- Alert if failure rate > 10%

## Configuration

### Environment Variables

```bash
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_IDS=

# Email (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
EMAIL_FALLBACK_TO=

# Action URLs
NOTIFY_ACTION_BASE_URL=
NOTIFY_ACTION_SECRET=

# Optional: SMS
SMS_API_KEY=
SMS_FROM_NUMBER=
SMS_FALLBACK_TO=
```

## Best Practices

### ✅ DO

1. **Keep templates pure** - No side effects, just return strings
2. **Dedupe aggressively** - Users hate spam
3. **Log everything** - Notification failures need visibility
4. **Fail gracefully** - Notification error ≠ job failure
5. **Use TTLs wisely** - Balance freshness vs spam prevention

### ❌ DON'T

1. **Mix content and delivery** - Templates shouldn't send
2. **Block job execution** - Use async/fire-and-forget if needed
3. **Hardcode content** - Always use templates
4. **Ignore dedupe** - Users will complain
5. **Store sensitive data** - Templates see full payload, be careful

## Future Enhancements

### 1. Notification Preferences

```typescript
interface NotificationPreferences {
  channels: {
    telegram: boolean;
    email: boolean;
    sms: boolean;
  };
  events: {
    slotFound: boolean;
    slotClosed: boolean;
    bookingConfirmed: boolean;
  };
  quietHours?: {
    start: string; // "22:00"
    end: string;   // "08:00"
    timezone: string;
  };
}
```

### 2. Template Variables

```typescript
// Support for dynamic template variables
const email = renderSlotOpenEmail({
  ...args,
  variables: {
    applicantName: payload.applicant_data?.name,
    customMessage: 'Your visa appointment is ready!',
  },
});
```

### 3. Multi-language Support

```typescript
export function renderSlotOpenEmail(args: {
  // ...existing
  locale?: 'en' | 'tr' | 'es';
}) {
  const t = translations[args.locale ?? 'en'];
  const subject = t.slotOpen.subject(args.jobId);
  // ...
}
```

### 4. Rich Templates (Handlebars/EJS)

```handlebars
<!-- templates/slot-open.hbs -->
<div style="font-family: Arial; padding: 20px;">
  <h1>🟢 Slot Available!</h1>
  <p>Job: <strong>{{jobId}}</strong></p>
  <p>Available dates:</p>
  <ul>
    {{#each dates}}
      <li>{{this}}</li>
    {{/each}}
  </ul>
  <a href="{{portalUrl}}" style="...">View Portal</a>
</div>
```

## Summary

✅ **Implemented:**
- Template layer for content generation
- Hash-based deduplication (5 min TTL)
- Multi-channel orchestration (Telegram + Email)
- Clean separation of concerns
- Payload passing from handlers

🎯 **Benefits:**
- Easy to add new templates (booking, payment, etc.)
- Easy to add new channels (SMS, Slack, webhook)
- No duplicate code in handlers
- Centralized deduplication
- Type-safe with TypeScript

🚀 **Production Ready:**
- No breaking changes to existing API
- Backward compatible
- Well-tested structure
- Documented architecture
