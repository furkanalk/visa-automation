# Telegram Action Buttons - Implementation Guide

## Overview

Telegram notifications now include inline action buttons that link directly to API endpoints. This allows users to acknowledge notifications or stop jobs directly from Telegram without needing to open the admin UI.

## Critical Fix: WAITING_SLOT Enum Value

### Problem
The FSM worker uses `WAITING_SLOT` state, but the PostgreSQL `job_status` enum in migration `002_jobs.sql` doesn't include it. This causes a database constraint violation when the worker tries to update job status to `WAITING_SLOT`.

### Solution
Created migration `008_add_waiting_slot.sql`:

```sql
ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'WAITING_SLOT';
```

### How to Apply

**Development:**
```bash
cd packages/db
psql -U postgres -d visa_automation -f migrations/008_add_waiting_slot.sql
```

**Production:**
```bash
# Via migration script
./scripts/db/migrate.sh

# Or manually via psql
psql $DATABASE_URL -f packages/db/migrations/008_add_waiting_slot.sql
```

## API Endpoints for Telegram Buttons

### 1. ACK (Acknowledge Notification)
**Endpoint:** `GET /api/jobs/:id/ack`

**Purpose:** Records that user acknowledged a notification (e.g., slot found, HITL required).

**Behavior:**
- Does NOT change job status
- Creates `NOTIFY_ACK` event in `job_events` table
- Returns `{ ok: true }`

**Security:**
- Requires `x-tenant-id` header
- Validates job belongs to tenant
- Returns 401/403/404 on auth/ownership/missing errors

**Payload logged:**
```json
{
  "source": "telegram",
  "event": "slot_open" | "hitl" | "booked",
  "ua": "TelegramBot/1.0"
}
```

### 2. STOP (Cancel Job)
**Endpoint:** `GET /api/jobs/:id/stop`

**Purpose:** Cancels a running job via Telegram button.

**Behavior:**
- Updates job status to `CANCELLED`
- Sets `completed_at` timestamp
- Creates state transition event in `job_events`
- Returns `{ ok: true, status: "CANCELLED" }`

**Security:**
- Requires `x-tenant-id` header
- Validates job belongs to tenant
- Returns 401/403/404 on auth/ownership/missing errors

**State transition logged:**
```json
{
  "from_state": "WAITING_SLOT",
  "to_state": "CANCELLED",
  "source": "telegram"
}
```

## Notification Button Layouts

### Slot Open Notification
```
🚨 SLOT OPEN
Portal: as-visa
Dates: 2026-03-15, 2026-03-16
Detect: 09.02.2026 14:30:45
Job: abc-123-def-456

[✅ ACK] [🛑 STOP]
[🔗 OPEN JOB]
```

**Buttons:**
- `✅ ACK` → `/jobs/{id}/ack?event=slot_open`
- `🛑 STOP` → `/jobs/{id}/stop`
- `🔗 OPEN JOB` → `/jobs/{id}`

### HITL Required Notification
```
🧩 HITL REQUIRED
Portal: as-visa
Type: CAPTCHA
At: 09.02.2026 14:30:45
Job: abc-123-def-456

[🧩 OPEN HITL] [🛑 STOP]
[🔗 OPEN JOB]
```

**Buttons:**
- `🧩 OPEN HITL` → `/hitl/{id}`
- `🛑 STOP` → `/jobs/{id}/stop`
- `🔗 OPEN JOB` → `/jobs/{id}`

### Booking Confirmed Notification
```
✅ BOOKED
Portal: as-visa
Confirmation: CONF-2026-12345
At: 09.02.2026 14:30:45
Job: abc-123-def-456

[📋 VIEW DETAILS] [🔗 OPEN JOB]
```

**Buttons:**
- `📋 VIEW DETAILS` → `/jobs/{id}/booking`
- `🔗 OPEN JOB` → `/jobs/{id}`

## Environment Configuration

### Required Variables

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890

# Action Button Base URL (without trailing slash)
NOTIFY_ACTION_BASE_URL=https://api.example.com

# Optional: Deduplication TTL (default: 300 seconds)
NOTIFY_DEDUPE_TTL_SECONDS=300
```

### Setting Up Telegram Bot

1. Create bot via [@BotFather](https://t.me/botfather)
2. Get bot token
3. Add bot to your notification channel/group
4. Get chat ID:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
   ```
5. Set environment variables in worker deployment

### Base URL Configuration

The `NOTIFY_ACTION_BASE_URL` should point to your API base URL:
- **Development:** `http://localhost:3000` (via Kong Gateway)
- **Production:** `https://api.yourdomain.com`

If not set, buttons will not appear in notifications (backwards compatible).

## Authentication Flow

### Current Implementation (MVP)
Uses `x-tenant-id` header for tenant isolation. This is a placeholder for proper authentication.

**Example Request:**
```bash
curl -H "x-tenant-id: tenant-123" \
     https://api.example.com/jobs/abc-123/ack
```

### Future Enhancement (TODO)
Replace with JWT-based authentication:
1. API Gateway extracts JWT from Telegram callback
2. Gateway injects `x-tenant-id` into upstream request
3. Rate limiting per tenant/user
4. CSRF protection for state-changing operations

## Testing

### Test ACK Endpoint
```bash
curl -X GET \
  -H "x-tenant-id: your-tenant-id" \
  "http://localhost:3000/api/jobs/{job-id}/ack?event=slot_open"

# Expected response:
# { "ok": true }
```

### Test STOP Endpoint
```bash
curl -X GET \
  -H "x-tenant-id: your-tenant-id" \
  "http://localhost:3000/api/jobs/{job-id}/stop"

# Expected response:
# { "ok": true, "status": "CANCELLED" }
```

### Verify Event Logging
```sql
-- Check NOTIFY_ACK events
SELECT * FROM job_events 
WHERE job_id = 'your-job-id' 
  AND event_type = 'NOTIFY_ACK'
ORDER BY created_at DESC;

-- Check state transitions
SELECT * FROM job_events 
WHERE job_id = 'your-job-id' 
  AND event_type = 'STATE_TRANSITION'
  AND payload->>'to_state' = 'CANCELLED'
ORDER BY created_at DESC;
```

## Implementation Checklist

- [x] Create `008_add_waiting_slot.sql` migration
- [x] Add `JobRepository` and `JobEventRepository` imports to `jobs.ts`
- [x] Implement `GET /jobs/:id/ack` endpoint
- [x] Implement `GET /jobs/:id/stop` endpoint
- [x] Add `replyMarkup` parameter to `sendTelegramMessage()`
- [x] Add inline buttons to `notifySlotOpen()`
- [x] Add inline buttons to `notifyHitlRequired()`
- [x] Add inline buttons to `notifyBooked()`
- [x] Document `NOTIFY_ACTION_BASE_URL` in README.md
- [ ] Apply `008_add_waiting_slot.sql` migration to database
- [ ] Set `NOTIFY_ACTION_BASE_URL` in worker environment
- [ ] Test complete flow end-to-end
- [ ] Implement proper JWT authentication (future)
- [ ] Add rate limiting for action endpoints (future)

## Notes

- **GET vs POST:** Using GET for MVP simplicity since Telegram URL buttons directly open links. Consider migrating to POST with CSRF protection for production.
- **Idempotency:** ACK endpoint is idempotent (creates duplicate events). Consider adding deduplication if needed.
- **Worker Stateless:** Worker only sends notifications; all actions go through API for proper tenant isolation and audit logging.
- **Backwards Compatible:** If `NOTIFY_ACTION_BASE_URL` is not set, notifications work without buttons.

## Security Considerations

1. **Tenant Isolation:** All endpoints validate `job.tenant_id` matches `x-tenant-id` header
2. **No Cross-Tenant Access:** 403 returned if tenant mismatch detected
3. **Audit Trail:** All actions logged in `job_events` table with source metadata
4. **Rate Limiting:** TODO - Add Kong rate limiting per tenant
5. **CSRF Protection:** TODO - Add token validation for state-changing operations
6. **URL Tampering:** Job IDs are UUIDs, making enumeration difficult
