/**
 * Notify severity / emoji convention.
 * See docs/REFERENCE.md (Notify section).
 */
export const NOTIFY_EMOJI = {
  SLOT_OPEN: '🟢',
  RETRY: '🟡',
  FAILED: '🔴',
  SLOT_CLOSED: '🔴',
  BOOKED: '🔵',
} as const;

/** Telegram message format (user-facing): SLOT OPEN 🚨, BOOKED ✅, HITL 🧩 */
export const TELEGRAM_EMOJI = {
  SLOT_OPEN: '🚨',
  BOOKED: '✅',
  HITL_REQUIRED: '🧩',
} as const;
