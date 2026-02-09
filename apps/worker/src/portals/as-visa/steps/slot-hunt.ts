import type { Page } from 'playwright';
import type { Throttler } from '../../../core/networking/throttler.js';
import type { RateLimiter } from '../../../core/networking/rate-limiter.js';
import { AS_VISA_SELECTORS as S } from '../selectors.js';
import { createHash } from 'node:crypto';

export async function slotHunt(args: {
  page: Page;
  baseUrl: string;
  throttler: Throttler;
  rateLimiter: RateLimiter;
}): Promise<{ found: boolean; dates?: string[]; confirmationNumber?: string }> {
  const { page, baseUrl, throttler, rateLimiter } = args;

  await rateLimiter.take();
  await throttler.beforeAction();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // Wait for essential form elements to ensure page is ready
  await page.waitForSelector(S.form, { timeout: 30_000 });
  await page.waitForSelector(S.selects.nationality, { timeout: 30_000 });
  await page.waitForSelector(S.selects.appointment, { timeout: 30_000 });
  await page.waitForSelector(S.selects.travelSubject, { timeout: 30_000 });
  await page.waitForSelector(S.inputs.travelDate, { timeout: 30_000 });
  await page.waitForSelector(S.inputs.appointmentDate, { timeout: 30_000 });

  // Check for Turnstile presence (detection only, no bypass)
  const hasTurnstile = (await page.$(S.security.turnstile)) !== null;
  if (hasTurnstile) {
    // Note: slot-hunt can continue for "availability" checking
    // but if moving to "booking" flow, HITL should be triggered
  }

    // Poll availability (reads window.dateDisabled populated by site JS)
  const MAX_POLLS = 12; // ~1-2 min depending on pacing
  let lastHash: string | null = null;

  for (let i = 0; i < MAX_POLLS; i++) {
    await rateLimiter.take();
    await throttler.beforeAction();

    const snap = await getAvailabilitySnapshot(page);

    if (snap.hash !== lastHash) {
      lastHash = snap.hash;
      // TODO: emit event/log "availability_changed" + snap.dates
      // (buraya ileride JobEvent / Notification bağlayacağız)
    }

    if (snap.dates.length > 0) {
      return { found: true, dates: snap.dates };
    }

    // jittered sleep between polls (throttler yoksa bile hafif bekleyelim)
    await sleep(1500 + Math.floor(Math.random() * 1500));
  }

  return { found: false };
}

async function getAvailabilitySnapshot(page: Page): Promise<{ dates: string[]; hash: string }> {
  const dates = await page.evaluate(() => {
    const arr = (globalThis as any).dateDisabled;
    return Array.isArray(arr) ? arr.map(String) : [];
  });

  // Stable + deterministic hash
  const normalized = dates.slice().sort().join('|');
  const hash = createHash('sha256').update(normalized).digest('hex');

  return { dates, hash };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
