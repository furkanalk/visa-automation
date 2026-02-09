# Worker Telegram Notifications - MVP Implementation

## Overview

This is the **MVP (Minimum Viable Product)** implementation of Telegram notifications for the worker. When a slot is found, the worker sends a detailed notification to configured Telegram chat(s) with inline action buttons.

## Architecture

### Modular Design

The notification system is split into two layers:

1. **telegram.ts** - Low-level Telegram Bot API wrapper
   - Handles HTTP communication with Telegram
   - Supports multiple chat IDs (fan-out)
   - Generic button structure

2. **index.ts** - High-level notification functions
   - `notifySlotFound()` - Sends slot availability notification
   - Environment configuration
   - Business logic (message formatting, button links)

### Flow

```
┌─────────────────────┐
│  FSM Handler        │
│  (PROCESSING)       │
│                     │
│  1. slotHunt()      │
│  2. res.found?      │
└──────┬──────────────┘
       │ YES
       ▼
┌─────────────────────┐
│  notifySlotFound()  │
│                     │
│  - Format message   │
│  - Add buttons      │
│  - Fan-out to chats │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  FSMHalt            │
│  (SLOT_FOUND)       │
│                     │
│  Job stops here     │
└─────────────────────┘
```

## Files Modified

### 1. `apps/worker/src/core/notify/telegram.ts`

**Complete rewrite** - Changed from single-chat to multi-chat architecture.

**Key Changes:**
- `TelegramButton` interface for inline buttons
- `chatIds: string[]` instead of single `chatId`
- `buttons?: TelegramButton[]` parameter
- Fan-out via `Promise.all()`
- Logger integration for error tracking

### 2. `apps/worker/src/core/notify/index.ts`

**Complete rewrite** - Simplified to single MVP notification function.

**Removed:**
- ❌ `notifySlotOpen()` - Old deduplication-based notification
- ❌ `notifyHitlRequired()` - HITL notifications (future iteration)
- ❌ `notifyBooked()` - Booking confirmations (future iteration)
- ❌ `dedupe.ts` dependency - Simplified for MVP

**Added:**
- ✅ `notifySlotFound()` - MVP slot notification with buttons
- ✅ Multi-chat support via CSV
- ✅ Environment helpers (`mustEnv`, `splitCsv`)

### 3. `apps/worker/src/portals/as-visa/fsm/handlers.ts`

**Added slot found notification:**

```typescript
if (res.found) {
  ctx.logger.info({ jobId: ctx.jobId, dates: res.dates }, 'Slot found');
  
  await notifySlotFound({
    jobId: ctx.jobId,
    portalId: ctx.portalConfig.portalId,
    tenantId: ctx.tenantId,
    baseUrl: ctx.portalConfig.baseUrl,
    dates: res.dates ?? [],
    logger: ctx.logger,
  });

  // Stop FSM at SLOT_FOUND (no auto-booking in MVP)
  throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
}
```

### 4. `apps/worker/src/core/fsm/runner.ts`

**Added SLOT_FOUND to state progression:**

```typescript
const stateProgression: JobState[] = [
  JOB_STATES.QUEUED,
  JOB_STATES.LOGIN_PROCESS,
  JOB_STATES.LOGGED_IN,
  JOB_STATES.FORM_FILLING,
  JOB_STATES.PROCESSING,
  JOB_STATES.SLOT_FOUND,      // ← NEW
  JOB_STATES.WAITING_SLOT,
  JOB_STATES.COMPLETED,
];
```

### 5. `apps/worker/src/processor.ts`

**Added SLOT_FOUND handler:**

```typescript
// Slot found (we notified via Telegram) — stop here for MVP
if (result.lastState === JOB_STATES.SLOT_FOUND) {
  await jobRepo.updateStatus(job_id, JOB_STATES.SLOT_FOUND);

  await eventRepo.createStateTransition(
    job_id,
    tenant_id,
    JOB_STATES.PROCESSING,
    JOB_STATES.SLOT_FOUND,
    { reason: 'Slot found (notified)', channel: 'telegram' }
  );

  await db.instance
    .updateTable('job_runs')
    .set({ status: 'COMPLETED', finished_at: new Date() })
    .where('id', '=', jobRun.id)
    .execute();

  logger.info({ jobId: job_id }, 'Job halted at SLOT_FOUND (MVP)');
  return;
}
```

**Removed old notification calls:**
- ❌ `notifySlotOpen()` call in WAITING_SLOT handler
- ❌ `notifyHitlRequired()` call in HITL handler  
- ❌ `notifyBooked()` call in completion handler

## Environment Variables

### Required

```bash
# Telegram Bot API Token (get from @BotFather)
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# Comma-separated list of chat IDs (supports multiple channels/groups)
TELEGRAM_CHAT_IDS=-1001234567890,-1009876543210

# Base URL for action button links (no trailing slash)
NOTIFY_ACTION_BASE_URL=https://api.yourdomain.com
```

### Optional

```bash
# Set to empty string to disable notifications (fail gracefully)
TELEGRAM_BOT_TOKEN=
```

### Getting Chat IDs

1. Add your bot to the target channel/group
2. Send a message in the channel/group
3. Fetch updates:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
   ```
4. Look for `"chat":{"id":-100...}` in the response

## Telegram Message Format

```
🟢 SLOT OPEN
• job: abc-123-def-456
• portal: as-visa
• tenant: tenant-uuid-123
• time: 2026-02-09T14:30:45.123Z
• dates: 2026-03-15, 2026-03-16, 2026-03-17
• url: https://as.oim.gov.tr/...

[✅ ACK] [🛑 STOP]
```

### Inline Buttons

1. **✅ ACK** - Acknowledge notification
   - URL: `${NOTIFY_ACTION_BASE_URL}/api/jobs/${jobId}/ack?event=slot_open`
   - Logs event to `job_events` table
   - Does NOT change job status

2. **🛑 STOP** - Cancel job
   - URL: `${NOTIFY_ACTION_BASE_URL}/api/jobs/${jobId}/stop`
   - Updates job status to `CANCELLED`
   - Logs state transition

## Job Lifecycle with Notifications

### Normal Flow (No Slots)

```
QUEUED
  ↓
LOGIN_PROCESS
  ↓
LOGGED_IN
  ↓
FORM_FILLING
  ↓
PROCESSING (slotHunt: no slots)
  ↓
WAITING_SLOT (scheduled retry in 30-90s)
  ↓
[Back to PROCESSING after delay]
```

### Slot Found Flow (MVP)

```
QUEUED
  ↓
LOGIN_PROCESS
  ↓
LOGGED_IN
  ↓
FORM_FILLING
  ↓
PROCESSING (slotHunt: found!)
  ├─ notifySlotFound() → Telegram 🟢
  └─ FSMHalt(SLOT_FOUND)
     ↓
SLOT_FOUND (job stops here)
     ↓
job_runs.status = COMPLETED
```

### Why Stop at SLOT_FOUND?

In the MVP, we **do not** implement automatic booking:

1. **Manual verification** - Human checks if dates are acceptable
2. **Manual booking** - Human completes booking via portal or resumes automation
3. **Simpler state machine** - No payment/confirmation states yet
4. **Safety** - Avoids accidental bookings

## Multi-Chat Fan-Out

The system supports sending notifications to multiple Telegram chats simultaneously:

```typescript
// Environment
TELEGRAM_CHAT_IDS=-1001234567890,-1009876543210,-1001122334455

// Implementation
await Promise.all(
  chatIds.map(async (chat_id) => {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      // ...
      body: JSON.stringify({ chat_id, ...payload }),
    });
  })
);
```

### Use Cases

- **Operations channel** - Main monitoring channel for all jobs
- **Client-specific channel** - Per-tenant notification groups
- **Archive channel** - Long-term log retention
- **Alert channel** - High-priority notifications only

## Error Handling

### Missing Environment Variables

```typescript
function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
```

**Behavior:** Job fails immediately if required env vars missing.

**Alternative:** Graceful degradation (log warning, skip notification):

```typescript
try {
  await notifySlotFound(...);
} catch (err) {
  logger.warn({ err }, 'Notification failed, continuing job');
}
```

### Telegram API Errors

If any chat fails, the entire notification fails (fail-fast approach).

**Production Enhancement:** Individual chat error handling:

```typescript
const results = await Promise.allSettled(
  chatIds.map(async (chat_id) => {
    // send message
  })
);

results.forEach((result, idx) => {
  if (result.status === 'rejected') {
    logger.error({ chat_id: chatIds[idx], err: result.reason }, 'Chat send failed');
  }
});
```

## Testing

### Unit Test (Dry Run)

```typescript
// Set mock environment
process.env.TELEGRAM_BOT_TOKEN = 'test-token';
process.env.TELEGRAM_CHAT_IDS = '-100123';
process.env.NOTIFY_ACTION_BASE_URL = 'http://localhost:3000';

// Mock fetch
global.fetch = jest.fn().mockResolvedValue({ ok: true });

// Call function
await notifySlotFound({
  jobId: 'test-job-123',
  portalId: 'as-visa',
  tenantId: 'tenant-456',
  baseUrl: 'https://as.oim.gov.tr',
  dates: ['2026-03-15', '2026-03-16'],
  logger: pinoLogger,
});

// Verify fetch was called
expect(fetch).toHaveBeenCalledWith(
  'https://api.telegram.org/bot test-token/sendMessage',
  expect.objectContaining({
    method: 'POST',
    body: expect.stringContaining('SLOT OPEN'),
  })
);
```

### Integration Test (Real Telegram)

1. Create test bot via @BotFather
2. Create private test channel
3. Add bot to channel
4. Get chat ID via `/getUpdates`
5. Set env vars in worker
6. Trigger job with slot available
7. Verify message appears in channel with buttons

### Manual Test

```bash
# Test notification endpoint directly
curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{
    "chat_id": "-1001234567890",
    "text": "🟢 <b>TEST NOTIFICATION</b>\n• job: test-123",
    "parse_mode": "HTML",
    "reply_markup": {
      "inline_keyboard": [[
        {"text": "✅ ACK", "url": "https://example.com/ack"},
        {"text": "🛑 STOP", "url": "https://example.com/stop"}
      ]]
    }
  }'
```

## Future Enhancements

### Phase 2: Deduplication

Add back Redis-based deduplication to prevent duplicate notifications:

```typescript
const key = `notify:slot_found:${portalId}:${jobId}:${sha(dates)}`;
const ok = await dedupeOnce({ key, ttlSeconds: 300 });
if (!ok) return; // skip duplicate
```

### Phase 3: Notification Variants

Re-add specialized notification functions:

- `notifyHitlRequired()` - CAPTCHA/verification prompts
- `notifyBooked()` - Booking confirmations
- `notifyError()` - Critical error alerts

### Phase 4: Webhook Callbacks

Instead of URL buttons, use callback queries for secure in-app actions:

```typescript
reply_markup: {
  inline_keyboard: [[
    { text: '✅ ACK', callback_data: 'ack:job-123' }
  ]]
}
```

Requires webhook handler in API to process callbacks.

### Phase 5: Rich Formatting

- Embed slot availability calendar
- Add job metadata (visa type, applicant name)
- Include direct portal link (if session can be resumed)
- Attach screenshots of available slots

## Comparison: Old vs New

| Feature | Old (API) | New (Worker MVP) |
|---------|-----------|------------------|
| **Notification trigger** | Manual/API calls | Automatic (FSM handler) |
| **Deduplication** | Redis SET NX EX | None (MVP simplicity) |
| **Chat support** | Single chat ID | Multiple chat IDs (CSV) |
| **Button style** | 3 buttons (ACK/STOP/OPEN) | 2 buttons (ACK/STOP) |
| **Message format** | Turkish time, severity | ISO time, structured |
| **Error handling** | Graceful (skip if no config) | Fail-fast (required env) |
| **State impact** | No state change | Job stops at SLOT_FOUND |

## Deployment Checklist

- [ ] Apply database migration `008_add_waiting_slot.sql`
- [ ] Set `TELEGRAM_BOT_TOKEN` in worker environment
- [ ] Set `TELEGRAM_CHAT_IDS` in worker environment (CSV)
- [ ] Set `NOTIFY_ACTION_BASE_URL` in worker environment
- [ ] Add bot to target Telegram channel(s)
- [ ] Test notification with real job
- [ ] Verify ACK button logs event
- [ ] Verify STOP button cancels job
- [ ] Monitor logs for notification errors

## Troubleshooting

### "Missing env: TELEGRAM_BOT_TOKEN"

**Cause:** Environment variable not set in worker container.

**Fix:** Add to `docker-compose.yml` or `.env`:

```yaml
services:
  worker:
    environment:
      TELEGRAM_BOT_TOKEN: "your-token-here"
```

### "telegram sendMessage failed: 400"

**Cause:** Invalid chat ID or bot not added to channel.

**Fix:** 
1. Verify chat ID is correct (negative for groups/channels)
2. Ensure bot is admin in channel (if posting as bot)
3. Check message format (HTML parse errors)

### "telegram sendMessage failed: 401"

**Cause:** Invalid bot token.

**Fix:** Regenerate token via @BotFather or check for typos.

### Job stuck at SLOT_FOUND

**Expected behavior** - Job should stop here in MVP.

**Next steps:**
1. Verify slot dates in Telegram notification
2. Manually book appointment if dates are acceptable
3. Or cancel job via STOP button if dates don't work
4. Future: Implement auto-booking pipeline

## Summary

This MVP implementation provides:

✅ **Immediate notifications** when slots are found  
✅ **Multi-chat support** for different teams/clients  
✅ **Action buttons** for quick acknowledgment/cancellation  
✅ **Clean separation** between notification and business logic  
✅ **Simple deployment** with environment variables only  

**Not included in MVP** (future iterations):
- Deduplication (can send duplicates if job retries)
- HITL/booking notifications
- Webhook callbacks (buttons are URLs only)
- Rich formatting/attachments
