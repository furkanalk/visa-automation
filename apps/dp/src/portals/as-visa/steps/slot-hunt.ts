import type { Page } from 'playwright';
import type { Logger } from 'pino';
import type { Throttler } from '../../../core/networking/throttler.js';
import type { RateLimiter } from '../../../core/networking/rate-limiter.js';
import { AS_VISA_SELECTORS as S } from '../pages/make-appointment/index.js';
import { setDateInput } from './date-input.js';
import { createHash } from 'node:crypto';

/** Minimal log interface shared by pino Logger and stub objects. */
type LogAdapter = Pick<Logger, 'info' | 'warn' | 'debug'>;

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
  /** Max iterations to wait for dateDisabled to become ready before aborting. Default: 20. */
  maxReadyWaits?: number;
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
  /** When true, only check dateDisabled for free days; skip 6-digit code (that is for final booking step only). */
  slotCheckOnly?: boolean;
  logger?: Logger;
}): Promise<SlotHuntResult> {
  const { page, baseUrl, throttler, rateLimiter, slotHunt: sh, applicantData, slotCheckOnly, logger } = args;
  const log: LogAdapter = logger ?? { info: () => {}, warn: () => {}, debug: () => {} };
  const maxPolls = Math.max(1, sh.maxPolls);
  const delayMin = Math.max(0, sh.pollDelayMinMs);
  const delayMax = Math.max(delayMin, sh.pollDelayMaxMs);

  await rateLimiter.take();
  await throttler.beforeAction();
  log.info({ baseUrl }, 'slotHunt: navigating to page');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  log.info({}, 'slotHunt: waiting for form selectors');
  await page.waitForSelector(S.form, { timeout: 30_000 });
  await page.waitForSelector(S.selects.nationality, { timeout: 30_000 });
  await page.waitForSelector(S.selects.appointment, { timeout: 30_000 });
  await page.waitForSelector(S.selects.travelSubject, { timeout: 30_000 });
  await page.waitForSelector(S.inputs.travelDate, { timeout: 30_000 });

  const travelDateVal = await page.inputValue(S.inputs.travelDate).catch(() => '');
  if (!travelDateVal.trim()) {
    // Use today+90 so the datepicker's endDate constraint (travelDate-15 = today+75)
    // comfortably covers all next-30-weekday slots returned by /TarihGetir.
    // Using today+7 caused endDate=today-8, blocking all future appointment dates.
    const d = new Date();
    d.setDate(d.getDate() + 90);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    await setDateInput(page, S.inputs.travelDate, `${dd}/${mm}/${yyyy}`);
  }

  log.info({}, 'slotHunt: dispatching #AppointmentTabID change, waiting for /TarihGetir response (30s timeout)');
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
    log.warn({}, 'slotHunt: /TarihGetir timeout or no response (check page triggers POST /AnBir/Macaristan/TarihGetir)');
    return { found: false, reason: 'tarihgetir_timeout' };
  }
  log.info({ url: tarihGetirResponse.url() }, 'slotHunt: TarihGetir received');
  const body = await tarihGetirResponse.text().catch(() => '');
  if (!isTarihGetirBodyValid(body)) {
    log.warn({}, 'slotHunt: TarihGetir body invalid or blocked');
    return { found: false, needsHitl: true, reason: 'blocked' };
  }

  // Parse the open dates directly from the TarihGetir response body.
  // This is more reliable than reading window.dateDisabled from the DOM (race with jQuery $.ajax callback).
  let tarihGetirDates: string[] = [];
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) {
      tarihGetirDates = parsed.map(String).filter((s) => TARIH_GETIR_DATE_LIKE.test(s.trim()));
    }
  } catch {
    // leave empty; fall through to DOM polling
  }

  // AJAX success callback'i window.dateDisabled'ı güncelleyene kadar kısa bekle (jQuery async)
  await sleep(300);

  // enteredCode pre-fill: only attempt when value is already known (e.g. pre-loaded from applicant_data).
  // If !slotCheckOnly and enteredCode input exists but value is unknown, do NOT abort here —
  // slot availability is checked first (polling loop below), and if a slot is found the HITL
  // mechanism in handlers.ts will prompt the operator for the code before submit.
  // This allows "run-booking" (slot_check_only=false, no open_dates) to work without a prior scout run.
  if (!slotCheckOnly) {
    const enteredCodeEl = await page.$(S.inputs.enteredCode);
    if (enteredCodeEl) {
      const code = applicantData?.enteredCode;
      if (code != null && String(code).trim()) {
        await rateLimiter.take();
        await throttler.beforeAction();
        await page.fill(S.inputs.enteredCode, String(code).trim());
        log.debug({}, 'slotHunt: pre-filled enteredCode from applicant_data');
      }
      // If code unknown, fall through to poll loop — HITL will handle it at submit time if needed.
    }
  }

  log.info({ maxPolls, delayMin, delayMax }, 'slotHunt: polling availability (dateDisabled = open days list per real AS-VISA semantics)');
  let lastHash: string | null = null;
  let pollsDone = 0;
  let lastReason: SlotHuntReason = 'no_open_days';
  const pollLoopStart = Date.now();

  // ready=false için ayrı sayaç: sonsuz bekleme önlemi
  const maxReadyWaits = Math.max(1, sh.maxReadyWaits ?? 20);
  let readyWaits = 0;
  // First poll uses tarihGetirDates as fallback in case window.dateDisabled isn't set yet by jQuery
  let firstPoll = true;

  while (pollsDone < maxPolls) {
    if (args.shouldAbort && (await args.shouldAbort())) {
      return { found: false, reason: 'aborted' };
    }

    const snapStart = Date.now();
    const snap = await getAvailabilitySnapshot(page, firstPoll ? tarihGetirDates : undefined);
    firstPoll = false;
    const snapMs = Date.now() - snapStart;

    if (!snap.ready) {
      readyWaits++;
      if (readyWaits > maxReadyWaits) {
        log.warn({ readyWaits, maxReadyWaits, elapsedMs: Date.now() - pollLoopStart }, 'slotHunt: dateDisabled not ready after max waits, aborting poll loop');
        return { found: false, reason: 'no_open_days' };
      }
      log.debug({ readyWaits, snapMs, elapsedMs: Date.now() - pollLoopStart }, 'slotHunt: not ready, waiting');
      const delayMs = delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));
      await sleep(delayMs);
      continue;
    }
    pollsDone++;

    if (snap.hash !== lastHash) {
      lastHash = snap.hash;
      // Hash değişti: dateDisabled listesi değişmiş.
      // GERÇEK AS-VISA semantiği: dateDisabled = AÇIK günler listesi.
      // Liste DOLU → açık günler var → verifyRealSlot ile doğrula.
      // Liste BOŞ → hiç açık gün yok → slot yok.
      if (snap.dates.length > 0) {
        log.info({ pollsDone, hash: snap.hash, dateCount: snap.dates.length }, 'slotHunt: hash changed, open days found → verifying real slot');
        // slotCheckOnly (scout): /TarihGetir returning open dates IS the authoritative signal.
        // Skipping verifyRealSlot (datepicker click) avoids a fragile UI interaction that isn't
        // needed just to confirm slot existence — it's only needed for the actual booking step.
        if (slotCheckOnly) {
          log.info({ pollsDone, dateCount: snap.dates.length }, 'slotHunt: slotCheckOnly=true, trusting TarihGetir open dates → found');
          return { found: true, dates: snap.dates, hash: snap.hash, reason: 'open_times_found' };
        }
        const hasRealSlot = await verifyRealSlot(page, log);
        log.info({ pollsDone, hasRealSlot }, 'slotHunt: verifyRealSlot result');
        if (hasRealSlot) {
          return { found: true, dates: snap.dates, hash: snap.hash, reason: 'open_times_found' };
        }
      } else {
        log.debug({ pollsDone, hash: snap.hash }, 'slotHunt: hash changed, dateDisabled empty → no open days');
      }
    }

    const delayMs = delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));
    log.debug({ pollsDone, maxPolls, snapMs, delayMs, elapsedMs: Date.now() - pollLoopStart }, 'slotHunt: poll done, sleeping');
    await sleep(delayMs);
  }

  log.info({ pollsDone, elapsedMs: Date.now() - pollLoopStart }, 'slotHunt: poll loop finished');
  return { found: false, hash: lastHash ?? undefined, reason: lastReason };
}

async function getAvailabilitySnapshot(
  page: Page,
  fallbackDates?: string[]
): Promise<{ dates: string[]; hash: string; ready: boolean }> {
  const raw = await page.evaluate(() => {
    const g = globalThis as unknown as { dateDisabled?: unknown[]; _dateDisabledReady?: boolean };
    const arr = g.dateDisabled;
    // ready = true if window.dateDisabled has been set (either by page var or AJAX callback)
    // We consider it ready if it's an array (including empty — that means no open slots)
    const ready = Array.isArray(arr);
    return { dates: Array.isArray(arr) ? arr.map(String) : [], ready };
  });

  // If DOM hasn't set window.dateDisabled yet but we have dates from the response body, use those.
  const dates = raw.ready ? raw.dates : (fallbackDates ?? []);
  const ready = raw.ready || (fallbackDates !== undefined);

  const normalized = dates.slice().sort().join('|');
  const hash = createHash('sha256').update(normalized).digest('hex');

  return { dates, hash, ready };
}

const APPOINTMENT_TIME_VISIBLE_MS = 5_000;
const APPOINTMENT_TIME_SETTLE_MS = 8_000;

/**
 * Adjusts #datepicker Bootstrap startDate/endDate constraints to cover window.dateDisabled (open dates).
 *
 * The real AS-VISA portal JS sets these constraints via the #TravelDate changeDate handler:
 *   startDate = travelDate - 45 days
 *   endDate   = travelDate - 15 days
 *
 * Bootstrap datepicker 1.3.0 adds its own .disabled class to day cells outside startDate/endDate
 * REGARDLESS of what beforeShowDay returns. So even if a date is in dateDisabled (= open), if it
 * falls outside the constraint window it won't be clickable, causing runStageB to find 0 enabled
 * day cells and return false — a false negative (slot exists but agent can't book it).
 *
 * Fix: read window.dateDisabled (already populated by /TarihGetir AJAX callback) and expand the
 * datepicker's startDate/endDate to tightly cover the returned open dates ±1 day.
 */
async function adjustDatepickerConstraints(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const g = globalThis as unknown as {
        $?: (s: string) => { datepicker: (...a: unknown[]) => unknown };
        dateDisabled?: unknown[];
      };
      if (!g.$ || !Array.isArray(g.dateDisabled) || g.dateDisabled.length === 0) return;
      const dates = (g.dateDisabled as string[])
        .map((s) => {
          const parts = String(s).split('-').map(Number);
          return parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : null;
        })
        .filter((d): d is Date => d !== null && !isNaN(d.getTime()))
        .sort((a, b) => a.getTime() - b.getTime());
      if (!dates.length) return;
      const earliest = new Date(dates[0].getTime());
      earliest.setDate(earliest.getDate() - 1);
      const latest = new Date(dates[dates.length - 1].getTime());
      latest.setDate(latest.getDate() + 1);
      g.$('#datepicker').datepicker('setStartDate', earliest);
      g.$('#datepicker').datepicker('setEndDate', latest);
    })
    .catch(() => undefined);
}

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
 * Koşul: en az bir enabled option (SaatGetir AJAX response geldi ve doldurdu).
 * `opts.length > 0` early-return kaldırıldı — boş select de length>0 yapabilir (placeholder vb).
 */
async function waitForTimeOptionsSettled(page: Page): Promise<void> {
  await page
    .waitForFunction(
      (sel: string) => {
        const g = globalThis as unknown as { document?: { querySelector: (s: string) => unknown } };
        const el = g.document?.querySelector(sel);
        if (!el || (el as unknown as { tagName: string }).tagName !== 'SELECT') return false;
        const opts = Array.from((el as unknown as { options: unknown[] }).options ?? []) as unknown as { disabled?: boolean; value?: string }[];
        return opts.some((o) => !o.disabled && (o.value?.trim() ?? '') !== '' && o.value !== '0');
      },
      S.selects.appointmentTime,
      { timeout: APPOINTMENT_TIME_SETTLE_MS }
    )
    .catch(() => null);
}

/**
 * Datepicker'dan ilk açık (enabled/orange) günü seçip en az bir açık saat slot'u var mı kontrol eder.
 * Gerçek AS-VISA semantiği: dateDisabled boş = tüm günler açık; ilk açık güne tıkla, saat seç.
 * Stage A: input fill + change (readonly değilse). Stage B: datepicker widget click.
 */
async function verifyRealSlot(page: Page, log?: LogAdapter): Promise<boolean> {
  const l: LogAdapter = log ?? { info: () => {}, warn: () => {}, debug: () => {} };
  const isReadonly =
    (await page.getAttribute(S.inputs.appointmentDate, 'readonly')) != null;
  l.info({ isReadonly }, 'verifyRealSlot: appointmentDate readonly check');

  if (!isReadonly) {
    // Pick a weekday ~7 days out — safely within the appointment window even when
    // TravelDate was set to the fallback today+90 (endDate = today+75).
    const d = new Date();
    d.setDate(d.getDate() + 7);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    const stageA = await runStageA(page, `${dd}/${mm}/${yyyy}`, l);
    l.info({ stageA }, 'verifyRealSlot: stageA result');
    if (stageA) return true;
  }

  return runStageB(page, '', l);
}

/** Stage A: fill + change, wait for #AppointmentTime, check enabled option (excl. value '0'). */
async function runStageA(page: Page, ddMmYyyy: string, log?: LogAdapter): Promise<boolean> {
  await page.fill(S.inputs.appointmentDate, ddMmYyyy).catch(() => null);
  await page.locator(S.inputs.appointmentDate).dispatchEvent('change').catch(() => null);
  const timeVisible = await page
    .waitForSelector(S.selects.appointmentTime, { state: 'visible', timeout: APPOINTMENT_TIME_VISIBLE_MS })
    .then(() => true)
    .catch(() => false);
  log?.info({ ddMmYyyy, timeVisible }, 'runStageA: appointmentTime visible check');
  if (!timeVisible) return false;
  return hasEnabledTimeOption(page);
}

/** Stage B: open datepicker by click, select enabled day (prefer target day-of-month), re-check time options.
 * Supports both jQuery UI (.ui-datepicker) and Bootstrap datepicker (.datepicker-dropdown). */
async function runStageB(page: Page, targetDayOfMonth: string, log?: LogAdapter): Promise<boolean> {
  try {
    // Adjust #datepicker Bootstrap startDate/endDate constraints to cover window.dateDisabled.
    // Must run before opening the datepicker popup so the correct day cells are rendered as enabled.
    await adjustDatepickerConstraints(page);
    log?.debug({}, 'runStageB: datepicker constraints adjusted');

    // Ensure #apDate section is visible — it's hidden until TravelDate is set via 'changeDate' event.
    const apDateVisible = await page.evaluate(() => {
      const g = globalThis as unknown as { $?: (sel: string) => { is: (s: string) => boolean; show: () => void } };
      if (g.$) {
        const hidden = g.$('#apDate').is(':hidden');
        if (hidden) g.$('#apDate').show();
        return !hidden;
      }
      const el = document.querySelector('#apDate') as HTMLElement | null;
      if (el && el.offsetParent === null) { el.style.display = ''; return false; }
      return true;
    }).catch(() => null);
    log?.info({ apDateVisible }, 'runStageB: apDate visibility');
    await sleep(200);

    await page.click(S.inputs.appointmentDate, { timeout: 3_000 }).catch(() => null);
    log?.info({}, 'runStageB: clicked appointmentDate');

    // Detect which datepicker flavour is present (jQuery UI or Bootstrap)
    const popupSel = await Promise.race([
      page.waitForSelector(S.datepicker.popup, { state: 'visible', timeout: 2_000 })
        .then(() => S.datepicker.popup).catch(() => null),
      page.waitForSelector(S.bootstrapDatepicker.popup, { state: 'visible', timeout: 2_000 })
        .then(() => S.bootstrapDatepicker.popup).catch(() => null),
    ]);
    log?.info({ popupSel }, 'runStageB: datepicker popup detected');

    if (!popupSel) {
      // Retry focus+click if no popup appeared
      await page.focus(S.inputs.appointmentDate).catch(() => null);
      await page.click(S.inputs.appointmentDate, { timeout: 2_000 }).catch(() => null);
      const retried = await Promise.race([
        page.waitForSelector(S.datepicker.popup, { state: 'visible', timeout: 3_000 })
          .then(() => S.datepicker.popup).catch(() => null),
        page.waitForSelector(S.bootstrapDatepicker.popup, { state: 'visible', timeout: 3_000 })
          .then(() => S.bootstrapDatepicker.popup).catch(() => null),
      ]);
      log?.info({ retried }, 'runStageB: popup retry result');
      if (!retried) return false;
    }

    const isBootstrap = await page.$(S.bootstrapDatepicker.popup).then(Boolean).catch(() => false);
    log?.info({ isBootstrap }, 'runStageB: isBootstrap');

    // Debug: count enabled day cells
    const currentMonthSel = isBootstrap ? S.bootstrapDatepicker.enabledDayCurrentMonth : S.datepicker.enabledDayCurrentMonth;
    const anyMonthSel = isBootstrap ? S.bootstrapDatepicker.enabledDay : S.datepicker.enabledDay;
    const enabledCount = await page.evaluate((sel: string) => document.querySelectorAll(sel).length, currentMonthSel).catch(() => -1);
    const allDayCount = await page.evaluate(() => document.querySelectorAll('.datepicker td.day, .ui-datepicker td:not(.ui-datepicker-unselectable)').length).catch(() => -1);
    log?.info({ enabledCount, allDayCount, sel: currentMonthSel }, 'runStageB: day cell counts');

    if (enabledCount === 0) {
      log?.warn({ enabledCount, allDayCount }, 'runStageB: no enabled day cells found, cannot click');
      return false;
    }

    // Use Playwright's native locator.click() so the real pointer event bubbles through jQuery's
    // delegated handler on .datepicker-dropdown. page.evaluate(.click()) fires a synthetic DOM
    // click that jQuery may not receive correctly in all Playwright versions.
    const targetNum = parseInt(targetDayOfMonth, 10);
    let dayClicked = false;

    // Try to find a cell matching targetDayOfMonth, otherwise take the first enabled cell.
    // Build a list of selectors: prefer current-month then any-month.
    for (const sel of [currentMonthSel, anyMonthSel]) {
      const locators = page.locator(sel);
      const count = await locators.count().catch(() => 0);
      log?.debug({ sel, count }, 'runStageB: locator count');
      if (count === 0) continue;

      // Find the best match
      let idx = 0;
      if (!Number.isNaN(targetNum)) {
        for (let i = 0; i < count; i++) {
          const text = ((await locators.nth(i).textContent().catch(() => '')) ?? '').trim();
          if (parseInt(text, 10) === targetNum) { idx = i; break; }
        }
      }
      await locators.nth(idx).click({ timeout: 3_000 }).catch(() => null);
      dayClicked = true;
      log?.info({ sel, idx, targetDayOfMonth }, 'runStageB: clicked day cell via locator');
      break;
    }

    log?.info({ dayClicked, targetDayOfMonth, isBootstrap }, 'runStageB: dayClicked result');
    if (!dayClicked) return false;

    // Wait for SaatGetir AJAX to fire after datepicker selection (changeDate → tarihGetir()).
    // If it doesn't fire (no network request) within a short window, that's OK — fall back to
    // waitForTimeOptionsSettled which polls the DOM.
    await page
      .waitForResponse((r) => r.url().includes('/SaatGetir') && r.status() === 200, { timeout: 3_000 })
      .catch(() => null);

    const timeVisible = await page.waitForSelector(S.selects.appointmentTime, { state: 'visible', timeout: APPOINTMENT_TIME_VISIBLE_MS }).then(() => true).catch(() => false);
    log?.info({ timeVisible }, 'runStageB: AppointmentTime visible');
    if (!timeVisible) return false;

    await waitForTimeOptionsSettled(page);
    const hasEnabled = await hasEnabledTimeOption(page);
    log?.info({ hasEnabled }, 'runStageB: hasEnabledTimeOption result');
    return hasEnabled;
  } catch {
    return false;
  }
}

/**
 * Booking için tarih ve saat seçimi yapar.
 * verifyRealSlot gibi datepicker'dan ilk açık güne tıklar,
 * ardından #AppointmentTime select'te ilk enabled option'ı seçer.
 * Returns selected flag plus the chosen appointmentDate and appointmentTime strings.
 */
export async function selectSlotForBooking(
  page: Page,
  log?: LogAdapter,
): Promise<{ selected: boolean; appointmentDate?: string; appointmentTime?: string }> {
  const l: LogAdapter = log ?? { info: () => {}, warn: () => {}, debug: () => {} };
  const isReadonly = (await page.getAttribute(S.inputs.appointmentDate, 'readonly')) != null;
  l.info({ isReadonly }, 'selectSlotForBooking: appointmentDate readonly check');

  /** Read the current values of the appointmentDate input and appointmentTime select from the DOM. */
  async function readSelectedSlotValues(): Promise<{ appointmentDate?: string; appointmentTime?: string }> {
    return page.evaluate((sels: { date: string; time: string }) => {
      const doc = globalThis.document;
      if (!doc) return {};
      const dateEl = doc.querySelector(sels.date) as HTMLInputElement | null;
      const timeEl = doc.querySelector(sels.time) as HTMLSelectElement | null;
      return {
        appointmentDate: dateEl?.value?.trim() || undefined,
        appointmentTime: timeEl?.value?.trim() && timeEl.value !== '0' ? timeEl.value.trim() : undefined,
      };
    }, { date: S.inputs.appointmentDate, time: S.selects.appointmentTime }).catch(() => ({}));
  }

  // Stage A: direct fill (non-readonly input)
  if (!isReadonly) {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    const dateStr = `${dd}/${mm}/${yyyy}`;
    await page.fill(S.inputs.appointmentDate, dateStr).catch(() => null);
    await page.locator(S.inputs.appointmentDate).dispatchEvent('change').catch(() => null);
    const timeVisible = await page
      .waitForSelector(S.selects.appointmentTime, { state: 'visible', timeout: APPOINTMENT_TIME_VISIBLE_MS })
      .then(() => true)
      .catch(() => false);
    if (timeVisible) {
      await waitForTimeOptionsSettled(page);
      const selected = await selectFirstEnabledTimeOption(page);
      if (selected) {
        const vals = await readSelectedSlotValues();
        l.info({ dateStr, ...vals }, 'selectSlotForBooking: stageA selected time');
        return { selected: true, appointmentDate: vals.appointmentDate ?? dateStr, appointmentTime: vals.appointmentTime };
      }
    }
  }

  // Stage B: datepicker widget click
  // Ensure #apDate container is visible — same as runStageB.
  // If #TravelDate was never filled, the portal hides #apDate and the datepicker click silently fails.
  try {
    await page.evaluate(() => {
      const g = globalThis as unknown as { $?: (sel: string) => { is: (s: string) => boolean; show: () => void } };
      if (g.$) {
        if (g.$('#apDate').is(':hidden')) g.$('#apDate').show();
      } else {
        const el = document.querySelector('#apDate') as HTMLElement | null;
        if (el) el.style.display = '';
      }
    }).catch(() => null);
    await new Promise<void>((r) => setTimeout(r, 200));

    // Click datepicker input — if it fails (e.g. element not interactable) bail out early
    let clickOk = false;
    await page.click(S.inputs.appointmentDate, { timeout: 3_000 }).then(() => { clickOk = true; }).catch(() => null);
    if (!clickOk) return { selected: false };

    const popupSel = await Promise.race([
      page.waitForSelector(S.datepicker.popup, { state: 'visible', timeout: 2_000 })
        .then(() => S.datepicker.popup).catch(() => null),
      page.waitForSelector(S.bootstrapDatepicker.popup, { state: 'visible', timeout: 2_000 })
        .then(() => S.bootstrapDatepicker.popup).catch(() => null),
    ]);
    if (!popupSel) return { selected: false };
    const isBootstrap = await page.$(S.bootstrapDatepicker.popup).then(Boolean).catch(() => false);
    const currentMonthSel = isBootstrap ? S.bootstrapDatepicker.enabledDayCurrentMonth : S.datepicker.enabledDayCurrentMonth;
    const anyMonthSel = isBootstrap ? S.bootstrapDatepicker.enabledDay : S.datepicker.enabledDay;
    for (const sel of [currentMonthSel, anyMonthSel]) {
      const locators = page.locator(sel);
      const count = await locators.count().catch(() => 0);
      if (count === 0) continue;
      await locators.first().click({ timeout: 3_000 }).catch(() => null);
      break;
    }
    // SaatGetir response beklenir; mock'ta hızlı gelir, gerçekte birkaç saniye — timeout düşük tutulabilir çünkü .catch ile yutulur
    await page
      .waitForResponse((r) => r.url().includes('/SaatGetir') && r.status() === 200, { timeout: 5_000 })
      .catch(() => null);
    const timeVisible = await page
      .waitForSelector(S.selects.appointmentTime, { state: 'visible', timeout: APPOINTMENT_TIME_VISIBLE_MS })
      .then(() => true)
      .catch(() => false);
    if (!timeVisible) return { selected: false };
    await waitForTimeOptionsSettled(page);
    const selected = await selectFirstEnabledTimeOption(page);
    const vals = await readSelectedSlotValues();
    l.info({ selected, ...vals }, 'selectSlotForBooking: stageB selected time');
    return { selected, appointmentDate: vals.appointmentDate, appointmentTime: vals.appointmentTime };
  } catch {
    return { selected: false };
  }
}

/** #AppointmentTime select'te ilk enabled, non-zero option'ı seçer. */
async function selectFirstEnabledTimeOption(page: Page): Promise<boolean> {
  return page.evaluate((sel: string) => {
    const doc = (globalThis as unknown as { document?: { querySelector: (s: string) => unknown } }).document;
    const el = doc?.querySelector(sel);
    if (!el || (el as unknown as { tagName: string }).tagName !== 'SELECT') return false;
    const opts = Array.from((el as unknown as { options: unknown[] }).options ?? []) as unknown as { disabled?: boolean; value?: string }[];
    const first = opts.find((o) => !o.disabled && (o.value?.trim() ?? '') !== '' && o.value !== '0');
    if (!first) return false;
    (el as unknown as { value: string }).value = first.value ?? '';
    const evt = new (globalThis as unknown as { Event: new (t: string, o?: object) => unknown }).Event('change', { bubbles: true });
    (el as unknown as { dispatchEvent: (e: unknown) => void }).dispatchEvent(evt);
    return true;
  }, S.selects.appointmentTime).catch(() => false);
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
