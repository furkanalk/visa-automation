import type { Page } from 'playwright';
import type { Throttler } from '../../../core/networking/throttler.js';
import type { RateLimiter } from '../../../core/networking/rate-limiter.js';
import { AS_VISA_SELECTORS as S } from '../pages/make-appointment/index.js';
import { createHash } from 'node:crypto';

/** Telemetry: neden slot bulunamadı / bulundu (prod debug). */
export type SlotHuntReason =
  | 'blocked'                 // captcha/cloudflare/login (200 but invalid body)
  | 'tarihgetir_timeout'      // /TarihGetir hiç gelmedi (network veya block ayrımı için)
  | 'no_open_days'            // ready, dates=[]
  | 'open_days_but_no_times'   // dates>0 but no enabled time slot
  | 'open_times_found'
  | 'aborted';

export interface SlotHuntResult {
  found: boolean;
  dates?: string[];
  hash?: string;
  confirmationNumber?: string;
  /** True when manual HITL input (e.g. 6-digit code) is on the page and we don't have the value yet */
  needsHitl?: boolean;
  /** Reason for result (telemetry / logs). */
  reason?: SlotHuntReason;
}

export interface SlotHuntConfig {
  maxPolls: number;
  pollDelayMinMs: number;
  pollDelayMaxMs: number;
}

export async function slotHunt(args: {
  page: Page;
  baseUrl: string;
  throttler: Throttler;
  rateLimiter: RateLimiter;
  /** Portal-specific: max polls and delay range between polls. */
  slotHunt: SlotHuntConfig;
  shouldAbort?: () => Promise<boolean>;
  /** If HITL code input is present and we have this (e.g. after resolve + requeue), we fill it and continue */
  applicantData?: Record<string, unknown>;
}): Promise<SlotHuntResult> {
  const { page, baseUrl, throttler, rateLimiter, slotHunt: sh, applicantData } = args;
  const maxPolls = Math.max(1, sh.maxPolls);
  const delayMin = Math.max(0, sh.pollDelayMinMs);
  const delayMax = Math.max(delayMin, sh.pollDelayMaxMs);

  await rateLimiter.take();
  await throttler.beforeAction();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // Wait for essential form elements to ensure page is ready.
  // Do not wait for #datepicker (appointmentDate) to be visible: the site shows it only after
  // Travel Date is selected; we only need the page/dateDisabled for availability polling.
  await page.waitForSelector(S.form, { timeout: 30_000 });
  await page.waitForSelector(S.selects.nationality, { timeout: 30_000 });
  await page.waitForSelector(S.selects.appointment, { timeout: 30_000 });
  await page.waitForSelector(S.selects.travelSubject, { timeout: 30_000 });
  await page.waitForSelector(S.inputs.travelDate, { timeout: 30_000 });

  // Travel Date boşsa set et (bazı akışlarda datepicker/step state'i için gerekli)
  const travelDateVal = await page.inputValue(S.inputs.travelDate).catch(() => '');
  if (!travelDateVal.trim()) {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    await page.fill(S.inputs.travelDate, `${dd}/${mm}/${yyyy}`);
  }

  // Availability yükleten tetik: #AppointmentTabID change → /TarihGetir; dateDisabled bu sayede dolar
  await page.evaluate(() => {
    const doc = (globalThis as unknown as { document?: { querySelector: (s: string) => unknown } }).document;
    const el = doc?.querySelector('#AppointmentTabID');
    if (el) {
      const EventCtor = (globalThis as unknown as { Event: new (type: string, opts?: { bubbles?: boolean }) => unknown }).Event;
      (el as unknown as { dispatchEvent: (e: unknown) => void }).dispatchEvent(new EventCtor('change', { bubbles: true }));
    }
  });
  const tarihGetirResponse = await page
    .waitForResponse((r) => r.url().includes('/TarihGetir') && r.status() === 200, { timeout: 30_000 })
    .catch(() => null);
  if (!tarihGetirResponse) {
    return { found: false, reason: 'tarihgetir_timeout' };
  }
  const body = await tarihGetirResponse.text().catch(() => '');
  if (isTarihGetirBodyValid(body)) {
    await page.evaluate(() => {
      (globalThis as unknown as Record<string, boolean>)['__asVisaDateDisabledReady'] = true;
    });
  } else {
    await page.evaluate(() => {
      (globalThis as unknown as Record<string, boolean>)['__asVisaBlocked'] = true;
    });
  }
  const blocked = await page.evaluate(() => Boolean((globalThis as unknown as Record<string, boolean>)['__asVisaBlocked']));
  if (blocked) return { found: false, needsHitl: true, reason: 'blocked' };

  // Manual HITL point: 6-digit code input (selector configured in as-visa selectors).
  // If this input is present and we don't have the value yet, trigger HITL. If we have it (after resolve + requeue), fill and continue.
  const enteredCodeEl = await page.$(S.inputs.enteredCode);
  if (enteredCodeEl) {
    const code = applicantData?.enteredCode;
    if (code != null && String(code).trim()) {
      await rateLimiter.take();
      await throttler.beforeAction();
      await page.fill(S.inputs.enteredCode, String(code).trim());
    } else {
      return { found: false, needsHitl: true };
    }
  }

  // Poll availability (reason set when we exit the loop or find slot) (reads window.dateDisabled populated by site JS); config from portal.
  let lastHash: string | null = null;
  let pollsDone = 0;
  let lastReason: SlotHuntReason = 'no_open_days';

  while (pollsDone < maxPolls) {
    if (args.shouldAbort && (await args.shouldAbort())) {
      return { found: false, reason: 'aborted' };
    }
    await rateLimiter.take();
    await throttler.beforeAction();

    const snap = await getAvailabilitySnapshot(page);

    if (!snap.ready) {
      const delayMs = delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));
      await sleep(delayMs);
      continue;
    }
    pollsDone++;

    if (snap.hash !== lastHash) {
      lastHash = snap.hash;
    }

    if (snap.dates.length > 0) {
      const hasRealSlot = await verifyRealSlot(page, snap.dates[0]);
      if (hasRealSlot) {
        return { found: true, dates: snap.dates, hash: snap.hash };
      }
    }

    const delayMs = delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));
    await sleep(delayMs);
  }

  return { found: false, hash: lastHash ?? undefined, reason: lastReason };
}

async function getAvailabilitySnapshot(
  page: Page
): Promise<{ dates: string[]; hash: string; ready: boolean }> {
  const raw = await page.evaluate(() => {
    const arr = (globalThis as unknown as { dateDisabled?: unknown[] }).dateDisabled;
    const ready = Boolean((globalThis as unknown as Record<string, boolean>)['__asVisaDateDisabledReady']);
    return { dates: Array.isArray(arr) ? arr.map(String) : [], ready };
  });

  const normalized = raw.dates.slice().sort().join('|');
  const hash = createHash('sha256').update(normalized).digest('hex');

  return { dates: raw.dates, hash, ready: raw.ready };
}

const APPOINTMENT_TIME_VISIBLE_MS = 5_000;
const APPOINTMENT_TIME_SETTLE_MS = 3_000;

/**
 * #AppointmentTime select'te en az bir etkin (disabled değil, value dolu ve !== '0') option var mı.
 */
async function hasEnabledTimeOption(page: Page): Promise<boolean> {
  return page.evaluate((sel: string) => {
    const doc = (globalThis as unknown as { document?: { querySelector: (s: string) => unknown } }).document;
    const el = doc?.querySelector(sel);
    if (!el || (el as unknown as { tagName: string }).tagName !== 'SELECT') return false;
    const opts = (el as unknown as { options: unknown[] }).options ?? [];
    return opts.some((o: unknown) => {
      const opt = o as { disabled?: boolean; value?: string };
      const v = (opt.value ?? '').trim();
      return !opt.disabled && v !== '' && v !== '0';
    });
  }, S.selects.appointmentTime);
}

/**
 * #AppointmentTime görünür olduktan sonra option'ların async dolmasını bekler.
 * Koşul: en az bir enabled option VAR veya option listesi doldu (no-slots settled).
 */
async function waitForTimeOptionsSettled(page: Page): Promise<void> {
  await page
    .waitForFunction(
      (sel: string) => {
        const g = globalThis as unknown as { document?: { querySelector: (s: string) => unknown } };
        const el = g.document?.querySelector(sel);
        if (!el || (el as unknown as { tagName: string }).tagName !== 'SELECT') return false;
        const opts = Array.from((el as unknown as { options: unknown[] }).options ?? []) as unknown as { disabled?: boolean; value?: string }[];
        const hasEnabled = opts.some((o) => !o.disabled && (o.value?.trim() ?? '') !== '' && o.value !== '0');
        if (hasEnabled) return true;
        if (opts.length > 0) return true;
        return false;
      },
      S.selects.appointmentTime,
      { timeout: APPOINTMENT_TIME_SETTLE_MS }
    )
    .catch(() => null);
}

/**
 * İlk uygun günü seçip en az bir açık saat slot'u var mı kontrol eder (false-positive önlemi).
 * Stage A: input fill + change (readonly değilse). Stage B: datepicker widget click (readonly veya A başarısızsa).
 */
async function verifyRealSlot(page: Page, firstDateStr: string): Promise<boolean> {
  const ddMmYyyy = toDdMmYyyy(firstDateStr);
  const targetDayOfMonth = ddMmYyyy.split('/')[0] ?? '';

  const isReadonly =
    (await page.getAttribute(S.inputs.appointmentDate, 'readonly')) != null;

  if (!isReadonly) {
    const stageA = await runStageA(page, ddMmYyyy);
    if (stageA) return true;
  }

  return runStageB(page, targetDayOfMonth);
}

/** Stage A: fill + change, wait for #AppointmentTime, check enabled option (excl. value '0'). */
async function runStageA(page: Page, ddMmYyyy: string): Promise<boolean> {
  await page.fill(S.inputs.appointmentDate, ddMmYyyy).catch(() => null);
  await page.locator(S.inputs.appointmentDate).dispatchEvent('change').catch(() => null);
  const timeVisible = await page
    .waitForSelector(S.selects.appointmentTime, { state: 'visible', timeout: APPOINTMENT_TIME_VISIBLE_MS })
    .then(() => true)
    .catch(() => false);
  if (!timeVisible) return false;
  return hasEnabledTimeOption(page);
}

/** Stage B: open datepicker by click, select enabled day (prefer target day-of-month), re-check time options. */
async function runStageB(page: Page, targetDayOfMonth: string): Promise<boolean> {
  try {
    await page.click(S.inputs.appointmentDate, { timeout: 3_000 }).catch(() => null);
    const popupVisible = await page.waitForSelector(S.datepicker.popup, { state: 'visible', timeout: 2_000 }).catch(() => null);
    if (!popupVisible) {
      await page.focus(S.inputs.appointmentDate).catch(() => null);
      await page.click(S.inputs.appointmentDate, { timeout: 2_000 }).catch(() => null);
      await page.waitForSelector(S.datepicker.popup, { state: 'visible', timeout: 3_000 }).catch(() => null);
    }

    const dayClicked = await page.evaluate(
      (arg: { currentMonthSel: string; anyMonthSel: string; targetDay: string }) => {
        const doc = (globalThis as unknown as { document?: { querySelectorAll: (s: string) => unknown[] } }).document;
        const tryClick = (sel: string) => {
          const links = doc?.querySelectorAll(sel) ?? [];
          const arr = Array.from(links) as unknown as { textContent?: string; click?: () => void }[];
          const targetNum = parseInt(arg.targetDay, 10);
          const match = arr.find((a) => {
            const t = String(a.textContent ?? '').trim();
            return t === arg.targetDay || (Number.isNaN(targetNum) ? false : parseInt(t, 10) === targetNum);
          });
          const toClick = match ?? arr[0];
          if (toClick?.click) {
            toClick.click();
            return true;
          }
          return false;
        };
        return tryClick(arg.currentMonthSel) || tryClick(arg.anyMonthSel);
      },
      {
        currentMonthSel: S.datepicker.enabledDayCurrentMonth,
        anyMonthSel: S.datepicker.enabledDay,
        targetDay: targetDayOfMonth,
      }
    );
    if (!dayClicked) return false;

    await page.waitForSelector(S.selects.appointmentTime, { state: 'visible', timeout: APPOINTMENT_TIME_VISIBLE_MS }).catch(() => null);
    await waitForTimeOptionsSettled(page);
    return hasEnabledTimeOption(page);
  } catch {
    return false;
  }
}

/** 'yyyy-mm-dd' veya 'dd.mm.yyyy' / 'dd/mm/yyyy' → 'dd/mm/yyyy'. */
function toDdMmYyyy(s: string): string {
  const t = s.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) {
    const [, y, m, d] = iso;
    return `${d!.padStart(2, '0')}/${m!.padStart(2, '0')}/${y}`;
  }
  const dmy = t.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${d!.padStart(2, '0')}/${m!.padStart(2, '0')}/${y}`;
  }
  return t;
}

/** AS-VISA: dateDisabled array elemanları genelde yyyy-mm-dd veya benzeri tarih string. */
const TARIH_GETIR_DATE_LIKE = /^\d{4}-\d{1,2}-\d{1,2}/;

/** /TarihGetir 200 olsa bile body HTML/captcha/blocked olabilir; sadece beklenen JSON array ise ready set edilir. */
function isTarihGetirBodyValid(body: string): boolean {
  const raw = (body ?? '').trim();
  if (raw.length === 0) return false;
  if (raw.startsWith('<') || raw.startsWith('<!')) return false;
  const lower = raw.toLowerCase();
  if (
    lower.includes('captcha') ||
    lower.includes('cloudflare') ||
    lower.includes('blocked') ||
    lower.includes('access denied') ||
    lower.includes('login') ||
    lower.includes('giriş yap')
  )
    return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return true;
      return parsed.some((el) => typeof el === 'string' && TARIH_GETIR_DATE_LIKE.test(String(el).trim()));
    }
    return typeof parsed === 'object' && parsed !== null && !('html' in parsed);
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
