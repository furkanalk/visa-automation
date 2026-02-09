# Critical Fixes - FSM State Transitions & Environment

## Summary

Fixed three critical issues that would prevent the worker from functioning correctly:

1. ✅ **Invalid FSM transition** (PROCESSING → SLOT_FOUND)
2. ✅ **Duplicate slot found logic** in processor.ts
3. ✅ **Missing environment variables** in docker-compose

---

## Issue 1: Invalid FSM Transition

### Problem

The FSM tried to transition directly from `PROCESSING` to `SLOT_FOUND`, but this transition was not defined in `shared/src/fsm/transitions.ts`. This would cause `isValidTransition()` to return `false` and crash the FSM.

### Root Cause

```typescript
// Handler was on wrong state
[JOB_STATES.PROCESSING]: async (ctx) => {
  // slot hunt logic...
  throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND }); // ❌ Invalid transition
}
```

Valid transitions:
- ✅ `PROCESSING → SLOT_SEARCHING` (exists)
- ✅ `SLOT_SEARCHING → SLOT_FOUND` (exists)
- ❌ `PROCESSING → SLOT_FOUND` (missing)

### Solution

Move slot hunting to `SLOT_SEARCHING` state to follow existing valid transitions.

### Files Changed

#### 1. `apps/worker/src/core/fsm/runner.ts`

Added `SLOT_SEARCHING` to state progression:

```typescript
const stateProgression: JobState[] = [
  JOB_STATES.QUEUED,
  JOB_STATES.LOGIN_PROCESS,
  JOB_STATES.LOGGED_IN,
  JOB_STATES.FORM_FILLING,
  JOB_STATES.PROCESSING,
  JOB_STATES.SLOT_SEARCHING,    // ← Added
  JOB_STATES.SLOT_FOUND,
  JOB_STATES.WAITING_SLOT,
  JOB_STATES.COMPLETED,
];
```

#### 2. `apps/worker/src/portals/as-visa/fsm/handlers.ts`

Changed handler key from `PROCESSING` to `SLOT_SEARCHING`:

```typescript
export const asVisaHandlers: Partial<Record<JobState, StateHandler>> = {
  [JOB_STATES.LOGIN_PROCESS]: async (ctx) => {
    // login logic...
  },

  [JOB_STATES.SLOT_SEARCHING]: async (ctx) => {  // ← Changed from PROCESSING
    const res = await slotHunt({...});
    
    if (res.found) {
      await notifySlotFound({...});
      throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });  // ✅ Now valid
    }
  },
};
```

#### 3. `apps/worker/src/processor.ts`

Updated state transition to reflect correct source state:

```typescript
await eventRepo.createStateTransition(
  job_id,
  tenant_id,
  JOB_STATES.SLOT_SEARCHING,  // ← Changed from PROCESSING
  JOB_STATES.SLOT_FOUND,
  { reason: 'Slot found (notified)', channel: 'telegram' }
);
```

### Flow Now

```
PROCESSING
    ↓ (automatic)
SLOT_SEARCHING
    ├─ Slot found → notifySlotFound() → FSMHalt(SLOT_FOUND)
    └─ No slot → continue to WAITING_SLOT
```

---

## Issue 2: Duplicate Slot Found Logic

### Problem

There were **two separate blocks** in `processor.ts` handling slot found scenarios:

1. **Block 1 (Correct):** Handled `result.lastState === JOB_STATES.SLOT_FOUND`
2. **Block 2 (Wrong):** Checked `dates?.length` and incorrectly transitioned to `WAITING_HITL`

### Root Cause

Legacy code from previous implementation that wasn't cleaned up. Block 2 was:
- Setting wrong state (`WAITING_HITL` instead of `SLOT_FOUND`)
- Using wrong transition source (`PROCESSING` instead of `SLOT_SEARCHING`)
- Could trigger accidentally if FSM result had dates in meta

### Solution

Removed the duplicate/incorrect block entirely.

### Code Removed

```typescript
// ❌ REMOVED - Duplicate and incorrect
// Slot found -> notify + park job (manual action)
const dates = (result as any).meta?.dates as string[] | undefined;
if (dates?.length) {
  await jobRepo.updateStatus(job_id, JOB_STATES.WAITING_HITL);  // Wrong state

  await eventRepo.createStateTransition(
    job_id,
    tenant_id,
    JOB_STATES.PROCESSING,     // Wrong source
    JOB_STATES.WAITING_HITL,   // Wrong target
    { reason: 'Slot found', dates }
  );

  await db.instance
    .updateTable('job_runs')
    .set({
      status: 'COMPLETED',
      finished_at: new Date(),
      checkpoint_data: { slot_found: true, dates },
    })
    .where('id', '=', jobRun.id)
    .execute();

  logger.warn({ jobId: job_id, dates }, 'SLOT FOUND -> manual action required');
  return;
}
```

### Correct Flow (After Fix)

```typescript
// ✅ CORRECT - Single source of truth
if (result.lastState === JOB_STATES.SLOT_FOUND) {
  await jobRepo.updateStatus(job_id, JOB_STATES.SLOT_FOUND);

  await eventRepo.createStateTransition(
    job_id,
    tenant_id,
    JOB_STATES.SLOT_SEARCHING,
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

---

## Issue 3: Missing Environment Variables

### Problem

The worker code uses `mustEnv()` to read Telegram configuration:

```typescript
const token = mustEnv('TELEGRAM_BOT_TOKEN');
const chatIds = splitCsv(mustEnv('TELEGRAM_CHAT_IDS'));
const actionBase = mustEnv('NOTIFY_ACTION_BASE_URL');
```

If these variables are missing, the worker will **crash at runtime** with:
```
Error: Missing env: TELEGRAM_BOT_TOKEN
```

### Solution

Added environment variables to Docker Compose configuration.

### Files Changed

#### 1. `infra/docker/docker-compose.yml`

Added Telegram environment variables to worker service:

```yaml
  worker:
    build:
      context: ../..
      dockerfile: apps/worker/Dockerfile
    container_name: visa-worker
    restart: unless-stopped
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${LOG_LEVEL:-info}
      WORKER_ID: worker-1
      WORKER_CONCURRENCY: 2
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: ${DB_NAME:-visa_automation}
      DB_USER: ${DB_USER:-postgres}
      DB_PASSWORD: ${DB_PASSWORD:-postgres}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      # Telegram Notifications
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}                           # ← Added
      TELEGRAM_CHAT_IDS: ${TELEGRAM_CHAT_IDS:-}                             # ← Added
      NOTIFY_ACTION_BASE_URL: ${NOTIFY_ACTION_BASE_URL:-http://localhost:8000} # ← Added
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
```

**Note:** Using `${VAR:-default}` syntax allows:
- Reading from `.env` file if present
- Using default/empty value if not set
- Preventing Docker Compose errors for missing vars

#### 2. `.env.example` (New File)

Created example environment file:

```bash
# Visa Automation Environment Variables
# Copy this file to .env and fill in your values

# Database Configuration
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=visa_automation

# Application Configuration
LOG_LEVEL=info
WORKER_CONCURRENCY=2

# Telegram Notifications (Required for worker)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_IDS=
NOTIFY_ACTION_BASE_URL=http://localhost:8000
```

#### 3. `README.md`

Updated environment variable documentation:

```markdown
| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | - | Telegram Bot API token (required for notifications) |
| `TELEGRAM_CHAT_IDS` | - | Comma-separated Telegram chat IDs (required for notifications) |
| `NOTIFY_ACTION_BASE_URL` | `http://localhost:8000` | Base URL for notification action buttons |
```

### Usage

**Step 1:** Copy example file
```bash
cp .env.example .env
```

**Step 2:** Edit `.env` with your credentials
```bash
# Get bot token from @BotFather
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# Get chat IDs from /getUpdates
TELEGRAM_CHAT_IDS=-1001234567890,-1009876543210

# Use Kong gateway URL
NOTIFY_ACTION_BASE_URL=http://localhost:8000
```

**Step 3:** Start services
```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

### Getting Telegram Credentials

#### 1. Create Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Follow prompts (name, username)
4. Copy token: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

#### 2. Get Chat IDs

**For a channel:**
1. Create a channel
2. Add your bot as admin
3. Send a test message
4. Fetch updates:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
   ```
5. Look for `"chat":{"id":-100...}`

**For multiple chats:**
```bash
TELEGRAM_CHAT_IDS=-1001234567890,-1009876543210,-1001122334455
```

Separate with commas (no spaces recommended, but whitespace is trimmed).

---

## Testing the Fixes

### 1. Verify Environment Variables

```bash
# In worker container
docker exec visa-worker env | grep TELEGRAM
# Should show:
# TELEGRAM_BOT_TOKEN=your-token
# TELEGRAM_CHAT_IDS=-100...
# NOTIFY_ACTION_BASE_URL=http://...
```

### 2. Verify State Transitions

Check logs when job processes:

```bash
docker logs visa-worker -f
```

Expected flow:
```
INFO: Processing job abc-123
INFO: State transition: QUEUED → LOGIN_PROCESS
INFO: State transition: LOGIN_PROCESS → LOGGED_IN
INFO: State transition: LOGGED_IN → FORM_FILLING
INFO: State transition: FORM_FILLING → PROCESSING
INFO: State transition: PROCESSING → SLOT_SEARCHING
INFO: Slot found (dates: 2026-03-15, 2026-03-16)
INFO: State transition: SLOT_SEARCHING → SLOT_FOUND
INFO: Job halted at SLOT_FOUND (MVP)
```

### 3. Verify Telegram Notification

Check your Telegram channel for message:

```
🟢 SLOT OPEN
• job: abc-123-def-456
• portal: as-visa
• tenant: tenant-uuid-123
• time: 2026-02-10T14:30:45.123Z
• dates: 2026-03-15, 2026-03-16
• url: https://as.oim.gov.tr/...

[✅ ACK] [🛑 STOP]
```

### 4. Test Action Buttons

Click **✅ ACK** button:
- Should open: `http://localhost:8000/api/jobs/abc-123/ack?event=slot_open`
- Should return: `{"ok": true}`
- Should log event in `job_events` table

Click **🛑 STOP** button:
- Should open: `http://localhost:8000/api/jobs/abc-123/stop`
- Should return: `{"ok": true, "status": "CANCELLED"}`
- Should update job status to `CANCELLED`

---

## Rollout Plan

### Development

1. ✅ Create `.env` from `.env.example`
2. ✅ Configure Telegram credentials
3. ✅ Apply database migration `008_add_waiting_slot.sql`
4. ✅ Start services: `docker compose up -d`
5. ✅ Test with mock job

### Staging

1. Set environment variables in deployment config
2. Apply database migration
3. Deploy worker with new code
4. Monitor logs for state transitions
5. Test with real job (low-priority portal)

### Production

1. **Pre-deployment:**
   - Apply migration during maintenance window
   - Set environment variables in k8s/helm
   - Test Telegram bot in production channel

2. **Deployment:**
   - Deploy worker (rolling update)
   - Monitor for errors
   - Verify first notification

3. **Post-deployment:**
   - Monitor state transition logs
   - Check Telegram message rate
   - Verify action button links resolve correctly

---

## Summary of Changes

| File | Change Type | Description |
|------|-------------|-------------|
| `apps/worker/src/core/fsm/runner.ts` | Modified | Added `SLOT_SEARCHING` to state progression |
| `apps/worker/src/portals/as-visa/fsm/handlers.ts` | Modified | Changed handler from `PROCESSING` to `SLOT_SEARCHING` |
| `apps/worker/src/processor.ts` | Modified | Fixed transition source, removed duplicate block |
| `infra/docker/docker-compose.yml` | Modified | Added Telegram env vars to worker |
| `.env.example` | Created | Example environment configuration |
| `README.md` | Modified | Documented Telegram env vars |

## Checklist

- [x] Fix FSM state transition (PROCESSING → SLOT_SEARCHING → SLOT_FOUND)
- [x] Remove duplicate slot found logic
- [x] Add environment variables to docker-compose
- [x] Create .env.example
- [x] Update README.md
- [x] No compilation errors
- [ ] Apply database migration
- [ ] Configure Telegram credentials
- [ ] Test end-to-end
