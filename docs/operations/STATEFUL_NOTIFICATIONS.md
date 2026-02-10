# Stateful Telegram Notifications with Redis

## Overview

Implemented a Redis-based stateful notification system that tracks slot status (open/closed) and prevents notification spam through intelligent deduplication.

## Features

### 1. **Slot Status Tracking** 🔄
- Redis stores last known status per job: `open` or `closed`
- Transitions trigger appropriate notifications:
  - `null → open` → Send "SLOT OPEN" 🟢
  - `open → open` (same hash) → Dedupe (no notification)
  - `open → open` (different hash) → Send "SLOT OPEN" 🟢
  - `open → closed` → Send "SLOT CLOSED" 🔴
  - `closed → closed` → No notification

### 2. **Hash-Based Deduplication** 🔐
- Each slot availability snapshot gets SHA-256 hash
- Hash includes sorted date list: `hash(dates.sort().join('|'))`
- Same hash = same slot dates = dedupe for 1 hour
- Different hash = dates changed = new notification

### 3. **Spam Prevention** 🛡️
- Slot open: 1-hour dedupe per job+hash combination
- Slot closed: 30-minute dedupe per job
- Prevents notification storms during rapid checks

## Implementation

### Files Modified

1. ✅ `apps/worker/src/portals/as-visa/steps/slot-hunt.ts`
   - Return `hash` in result
   - Hash available slots snapshot

2. ✅ `apps/worker/src/core/notify/status.ts` (NEW)
   - Redis slot status tracking
   - Get/set status with 2-day TTL

3. ✅ `apps/worker/src/core/notify/index.ts`
   - Added `hash` parameter to `notifySlotFound`
   - Dedupe based on job+hash
   - Track status as `open`
   - New `notifySlotClosed` function

4. ✅ `apps/worker/src/portals/as-visa/fsm/handlers.ts`
   - Pass `hash` to `notifySlotFound`
   - Check previous status
   - Set status to `closed` when no slots
   - Notify if transition from `open → closed`

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Slot Hunt Cycle                           │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                   ┌────────────────────────┐
                   │   slotHunt()           │
                   │                        │
                   │   Returns:             │
                   │   - found: boolean     │
                   │   - dates: string[]    │
                   │   - hash: string       │
                   └────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │                               │
           found=true                      found=false
                │                               │
                ▼                               ▼
   ┌────────────────────────┐      ┌────────────────────────┐
   │ notifySlotFound()      │      │ Check previous status  │
   │                        │      │                        │
   │ 1. Get prev status     │      │ prev = getSlotStatus() │
   │ 2. Set status: 'open'  │      │ setSlotStatus('closed')│
   │ 3. Check dedupe        │      │                        │
   │    key: job+hash       │      │ if prev === 'open':    │
   │    TTL: 1 hour         │      │   notifySlotClosed()   │
   │ 4. If new: send 🟢     │      └────────────────────────┘
   └────────────────────────┘
```

### Redis Keys

**Slot Status:**
```
Key: slot_status:{jobId}
Value: "open" | "closed"
TTL: 2 days (172800 seconds)
```

**Deduplication:**
```
Key: slot_open:{jobId}:{hash}
Value: "1"
TTL: 1 hour (3600 seconds)

Key: slot_closed:{jobId}
Value: "1"
TTL: 30 minutes (1800 seconds)
```

### Hash Algorithm

```typescript
// In getAvailabilitySnapshot()
const dates = ['2026-03-15', '2026-03-20', '2026-03-18']; // from page
const normalized = dates.slice().sort().join('|');         // "2026-03-15|2026-03-18|2026-03-20"
const hash = createHash('sha256').update(normalized).digest('hex');
// hash: "a3f5e8..."
```

**Properties:**
- ✅ Deterministic (same dates → same hash)
- ✅ Order-independent (sorted before hashing)
- ✅ Collision-resistant (SHA-256)
- ✅ Efficient (32-byte hex string)

## Notification Examples

### Scenario 1: First Slot Found

```
Time: 10:00
Slots: [2026-03-15, 2026-03-20]
Hash: a3f5e8...
Redis: slot_status:job-123 = null

Action:
1. Set slot_status:job-123 = "open"
2. Check dedupe: slot_open:job-123:a3f5e8... → NEW
3. Send notification:

🟢 SLOT OPEN
• job: job-123
• portal: as-visa
• tenant: tenant-456
• time: 2026-02-10T10:00:00Z
• dates: 2026-03-15, 2026-03-20
• url: https://as.oim.gov.tr/...

[✅ ACK] [🛑 STOP]
```

### Scenario 2: Same Slots (Dedupe)

```
Time: 10:05 (5 minutes later)
Slots: [2026-03-15, 2026-03-20]
Hash: a3f5e8... (SAME)
Redis: slot_status:job-123 = "open"
       slot_open:job-123:a3f5e8... = "1" (TTL: 55 min)

Action:
1. Set slot_status:job-123 = "open" (already open)
2. Check dedupe: slot_open:job-123:a3f5e8... → EXISTS
3. Log: "Slot open notification deduped"
4. No notification sent ✅
```

### Scenario 3: Slots Changed (Different Hash)

```
Time: 10:30
Slots: [2026-03-15, 2026-03-18, 2026-03-20]  (added 2026-03-18)
Hash: b7d2f1... (DIFFERENT)
Redis: slot_status:job-123 = "open"
       slot_open:job-123:a3f5e8... = "1" (TTL: 30 min)

Action:
1. Set slot_status:job-123 = "open"
2. Check dedupe: slot_open:job-123:b7d2f1... → NEW (different hash!)
3. Send notification:

🟢 SLOT OPEN
• job: job-123
• dates: 2026-03-15, 2026-03-18, 2026-03-20  (NEW DATE!)
• time: 2026-02-10T10:30:00Z
...

[✅ ACK] [🛑 STOP]
```

### Scenario 4: Slots Closed

```
Time: 11:00
Slots: []
Hash: undefined (or hash of empty list)
Redis: slot_status:job-123 = "open"

Action:
1. Get prev status: "open"
2. Set slot_status:job-123 = "closed"
3. Transition: open → closed
4. Check dedupe: slot_closed:job-123 → NEW
5. Send notification:

🔴 SLOT CLOSED
• job: job-123
• portal: as-visa
• tenant: tenant-456
• time: 2026-02-10T11:00:00Z
• url: https://as.oim.gov.tr/...
```

### Scenario 5: Slots Still Closed (No Spam)

```
Time: 11:05
Slots: []
Redis: slot_status:job-123 = "closed"
       slot_closed:job-123 = "1" (TTL: 25 min)

Action:
1. Get prev status: "closed"
2. Set slot_status:job-123 = "closed"
3. No transition (closed → closed)
4. No notification sent ✅
```

## Deduplication Logic

### Slot Open Dedupe

```typescript
const dedupeKey = `slot_open:${jobId}:${hash ?? 'nohash'}`;
const isNew = await dedupeOnce({ key: dedupeKey, ttlSeconds: 3600 });
if (!isNew) {
  logger.debug('Slot open notification deduped');
  return; // Don't send
}
```

**Why 1 hour?**
- Prevents spam during frequent checks (e.g., every 30s)
- Long enough to avoid annoyance
- Short enough to notify if user missed first message

**Why per hash?**
- Different dates = different notification
- User wants to know when new dates appear
- Hash changes = slot availability changed

### Slot Closed Dedupe

```typescript
const isNew = await dedupeOnce({ key: `slot_closed:${jobId}`, ttlSeconds: 1800 });
if (!isNew) return; // Don't send
```

**Why 30 minutes?**
- Shorter than open (less critical information)
- Prevents "closed, open, closed" spam loops
- Still informs user of state changes

**Why not per hash?**
- No slots = no hash needed
- Just track that we notified "closed" recently
- Simpler logic

## Redis Client Management

### Singleton Pattern

```typescript
let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
    });
  }
  return redis;
}
```

**Benefits:**
- ✅ Single connection per worker process
- ✅ Connection reuse (efficient)
- ✅ No connection leak
- ✅ Lazy initialization

**Consideration:**
- Connection is never explicitly closed
- In long-running worker: OK (process lifecycle manages it)
- In short-lived script: Should add cleanup handler

## Testing Scenarios

### Test 1: Initial Slot Detection

```bash
# Start job with no slots initially
curl -X POST http://localhost:3000/api/jobs \
  -H "x-tenant-id: test-tenant" \
  -d '{"portal_id":"as-visa","visa_type":"SCHENGEN",...}'

# Mock portal: Add slots
# Result: 🟢 SLOT OPEN notification
```

### Test 2: Dedupe Same Slots

```bash
# Job checks again (same slots)
# Result: No notification (deduped)
```

### Test 3: Slots Change

```bash
# Mock portal: Change available dates
# Result: 🟢 SLOT OPEN notification (new hash)
```

### Test 4: Slots Disappear

```bash
# Mock portal: Remove all slots
# Result: 🔴 SLOT CLOSED notification
```

### Test 5: Spam Prevention

```bash
# Job checks every 30 seconds for 30 minutes
# Result: 
#   - First open: Notification
#   - Next 59 checks: Deduped
#   - After 1 hour: Notification again (if still open)
```

## Monitoring & Debugging

### Redis Keys Inspection

```bash
# Check slot status
redis-cli GET slot_status:job-123
# Output: "open" or "closed"

# Check dedupe keys
redis-cli KEYS "slot_open:job-123:*"
redis-cli KEYS "slot_closed:job-123"

# Check TTL
redis-cli TTL slot_open:job-123:a3f5e8...
# Output: 3456 (seconds remaining)
```

### Log Messages

**Slot Found:**
```
INFO: Slot found (dates: 2026-03-15, 2026-03-20)
```

**Deduped:**
```
DEBUG: Slot open notification deduped
```

**Slot Closed:**
```
INFO: No slot found, waiting
```

### Worker Logs

```bash
docker logs visa-worker -f --tail=100 | grep -E "Slot|notification"
```

## Performance Considerations

### Redis Operations

| Operation | Time | Impact |
|-----------|------|--------|
| GET status | ~1ms | Negligible |
| SET status | ~1ms | Negligible |
| SET NX EX (dedupe) | ~1ms | Negligible |

**Total overhead per slot check:** ~3ms (0.003s)

### Network Calls

| Call | Time | When |
|------|------|------|
| Telegram API | ~200-500ms | Only on new notification |
| Redis GET/SET | ~1ms | Every slot check |

**Optimization:** Redis is in same datacenter/network as worker (low latency)

### Memory Usage

**Per job in Redis:**
- Status key: ~50 bytes
- Dedupe key (open): ~100 bytes
- Dedupe key (closed): ~80 bytes

**Total:** ~230 bytes per active job

**For 10,000 jobs:** ~2.3 MB (negligible)

## Edge Cases Handled

### 1. Worker Restart

```
Scenario: Worker crashes mid-notification
Redis: Keys persist (TTL continues)
Result: On restart, dedupe still active ✅
```

### 2. Redis Unavailable

```
Scenario: Redis connection fails
Code: Throws error → Job fails → Retries
Result: Eventually connects or job fails after max retries
```

**Improvement:** Graceful degradation (skip notifications, continue job)

### 3. Clock Skew

```
Scenario: Server time drifts
Impact: TTL may expire early/late
Mitigation: Use NTP for time sync
```

### 4. Hash Collision

```
Scenario: Two different date sets → same hash
Probability: 2^-256 (astronomically low)
Impact: False dedupe (miss one notification)
Risk: Acceptable for SHA-256
```

### 5. Multiple Workers Same Job

```
Scenario: Two workers process same job (BullMQ prevents this)
Redis: SET NX ensures only one notification sent
Result: Dedupe prevents duplicates ✅
```

## Future Enhancements

### Phase 2: Per-Slot Tracking

Track individual dates, not just overall status:

```typescript
// Current: "slots open" or "slots closed"
// Future: Track each date separately
const slotsNow = ['2026-03-15', '2026-03-20'];
const slotsBefore = await getSlotDates(jobId);

const newSlots = slotsNow.filter(d => !slotsBefore.includes(d));
const removedSlots = slotsBefore.filter(d => !slotsNow.includes(d));

if (newSlots.length) {
  notifyNewSlots(newSlots); // "2026-03-18 now available!"
}
if (removedSlots.length) {
  notifyRemovedSlots(removedSlots); // "2026-03-15 no longer available"
}
```

### Phase 3: User Preferences

Per-user notification settings:

```typescript
interface NotifyPrefs {
  enabled: boolean;
  minDelayMinutes: number;  // Min time between notifications
  slotOpenOnly: boolean;     // Skip "closed" notifications
  dateFilters: string[];     // Only notify for specific dates
}
```

### Phase 4: Smart Retry Scheduling

Adjust retry delay based on slot history:

```typescript
if (prev === 'open' && now === 'closed') {
  // Slots just closed → check more frequently
  scheduleRetry(30); // 30 seconds
} else if (prev === 'closed' && now === 'closed') {
  // Still closed → back off
  scheduleRetry(300); // 5 minutes
}
```

## Summary

✅ **Hash-based deduplication** prevents spam for unchanged slots  
✅ **Status tracking** detects open→closed transitions  
✅ **Redis persistence** survives worker restarts  
✅ **Configurable TTLs** balance spam prevention vs timeliness  
✅ **Efficient** (<5ms overhead per check)  
✅ **Scalable** (minimal Redis memory usage)  

🎯 **Result:** Users get timely notifications without spam! 🎉
