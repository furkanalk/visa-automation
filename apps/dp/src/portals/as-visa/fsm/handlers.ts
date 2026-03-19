import type { JobState } from '@visa-automation/shared';
import { JOB_STATES } from '@visa-automation/shared';
import { FSMHalt } from '../../../core/fsm/runner.js';
import type { StateHandler } from '../../../core/fsm/runner.js';
import { slotHunt, selectSlotForBooking } from '../steps/slot-hunt.js';
import { fillForm } from '../steps/fill-form.js';
import { AS_VISA_SELECTORS as S } from '../pages/make-appointment/index.js';
import { notifySlotFound, notifySlotClosed } from '../../../core/notify/index.js';
import { getSlotStatus, setSlotStatus } from '../../../core/notify/status.js';
import { uploadScreenshotToCp, uploadHtmlDumpToCp } from '../../../core/upload-screenshot.js';
import { callSlotOpen } from '../../../core/call-slot-open.js';
import { db, JobRepository } from '@visa-automation/db';
import type { Page } from 'playwright';
import type { Logger } from 'pino';
import { waitForHitlResolution, HitlExpiredError } from '../../../core/hitl/handler.js';

/**
 * Dumps the post-booking confirmation page artifacts to CP for inspection.
 * Saves: final URL (txt), full HTML, same-origin JS files (bundled).
 * All operations are best-effort — failures are logged but never throw.
 */
async function dumpPostBookingArtifacts(
  page: Page,
  tenantId: string,
  jobId: string,
  logger: Logger,
): Promise<void> {
  try {
    const finalUrl = page.url();

    await uploadScreenshotToCp(
      tenantId, jobId, 'post-booking-url.txt',
      Buffer.from(finalUrl, 'utf8'), 'text/plain',
    ).catch(() => {});

    const html = await page.content().catch(() => null);
    if (html) {
      await uploadHtmlDumpToCp(tenantId, jobId, 'post-booking-page.html', html).catch(() => {});
    }

    // Fetch same-origin external scripts; inline scripts are already in the HTML dump.
    const scriptBundles = await page.evaluate(async () => {
      const origin = window.location.origin;
      const els = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];
      const settled = await Promise.allSettled(
        els.map(async (el) => {
          const src = el.src;
          if (!src.startsWith(origin)) return `/* EXTERNAL — skipped: ${src} */`;
          try {
            const r = await fetch(src);
            const text = r.ok ? await r.text() : `/* HTTP ${r.status} */`;
            return `/* === ${src} === */\n${text}`;
          } catch {
            return `/* fetch error: ${src} */`;
          }
        }),
      );
      return settled.map((r) => (r.status === 'fulfilled' ? r.value : '/* fetch failed */'));
    }).catch(() => [] as string[]);

    if (scriptBundles.length > 0) {
      await uploadScreenshotToCp(
        tenantId, jobId, 'post-booking-scripts.js',
        Buffer.from(scriptBundles.join('\n\n'), 'utf8'), 'text/javascript',
      ).catch(() => {});
    }
  } catch (e) {
    logger.warn({ err: e }, 'dumpPostBookingArtifacts failed');
  }
}

/**
 * Reads the confirmation number from the post-submit page.
 * Tries `data-confirmation` attribute first (mock portal), then text content.
 * Uses locator.waitFor so it reacts the moment the element appears — no busy-loop.
 */
async function readConfirmationNumber(page: Page, timeoutMs = 12_000): Promise<string | undefined> {
  try {
    // Wait for the page to settle after navigation first
    await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});

    // Try each selector individually — Playwright waitForSelector supports CSS comma selectors
    // but some versions can be unreliable. Try sequentially with short timeouts.
    const selectors = ['[data-confirmation]', '#confirmationNumber', '.confirmation-number'];
    for (const sel of selectors) {
      try {
        const el = await page.waitForSelector(sel, { state: 'visible', timeout: 5_000 });
        if (!el) continue;
        const attr = await el.getAttribute('data-confirmation').catch(() => null);
        if (attr && attr.trim()) return attr.trim();
        const text = await el.textContent().catch(() => null);
        if (text) return text.replace(/^Confirmation:\s*/i, '').trim() || undefined;
      } catch {
        // Not found with this selector, try next
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the meta block for FSMHalt from preSubmitDiag (form page fields) with
 * applicant_data as fallback when the evaluate didn't capture values.
 */
function buildBookingMeta(
  diag: Record<string, unknown>,
  applicantData: Record<string, unknown>,
  dates?: unknown,
  slotValues?: { appointmentDate?: string; appointmentTime?: string },
): Record<string, unknown> {
  const pick = (diagKey: string, ...adKeys: string[]): string => {
    // Highest priority: values returned directly from selectSlotForBooking (freshly read from DOM)
    if (slotValues) {
      if (diagKey === 'appointmentDate' && slotValues.appointmentDate) return slotValues.appointmentDate;
      if (diagKey === 'appointmentTime' && slotValues.appointmentTime) return slotValues.appointmentTime;
    }
    const d = diag[diagKey];
    if (d && typeof d === 'string' && d !== '(missing)' && d.trim()) return d.trim();
    for (const k of adKeys) {
      const v = applicantData[k];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return '';
  };

  // Resolve travel date: explicit from form/AD, or derive from resolved appointment date (+30 days).
  // When travelDateMode is "auto" no travelDate/travelDateSingle/travelDateFrom is set in AD,
  // so we fall back to appointmentDate + 30 days — this keeps the portal's acceptance window
  // (travelDate-45 … travelDate-15) satisfied and gives a meaningful display value.
  const resolveTravelDate = (): string => {
    const explicit = pick('travelDate', 'travelDate', 'travelDateSingle', 'travelDateFrom');
    if (explicit) return explicit;
    // Derive from the confirmed appointment date
    const apptStr = pick('appointmentDate', 'appointmentDate');
    if (!apptStr) return '';
    // Parse DD/MM/YYYY or YYYY-MM-DD
    const parseDdMm = (s: string): Date | null => {
      const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy) { const d = new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1])); return isNaN(d.getTime()) ? null : d; }
      const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (ymd) { const d = new Date(Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3])); return isNaN(d.getTime()) ? null : d; }
      return null;
    };
    const appt = parseDdMm(apptStr);
    if (!appt) return '';
    appt.setUTCDate(appt.getUTCDate() + 30);
    const dd = String(appt.getUTCDate()).padStart(2, '0');
    const mm = String(appt.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${appt.getUTCFullYear()}`;
  };

  return {
    bookedAt: new Date().toISOString(),
    ...(dates !== undefined ? { dates } : {}),
    appointmentDate: pick('appointmentDate', 'appointmentDate'),
    appointmentTime: pick('appointmentTime', 'appointmentTime'),
    travelDate: resolveTravelDate(),
    travelSubject: pick('travelSubject', 'travelSubject'),
    appointment: pick('appointment', 'appointment'),
    nationality: pick('nationality', 'nationality'),
  };
}

/**
 * Submit öncesi CAPTCHA / turnstile'ın çözülmesini bekler.
 * - Submit butonu disabled iken bekler (auto-solve: captchaAutoSolveDelayMs ms sonra enable olur).
 * - cfToken input'u varsa value set edilene kadar da bekler.
 * - maxWaitMs: toplam bekleme süresi (captchaAutoSolveDelayMs + buffer olmalı).
 */
async function waitForSubmitReady(page: Page, maxWaitMs = 15_000): Promise<void> {
  const submitLocator = page.locator(S.submit);
  // Wait until button is not disabled (Playwright `enabled` state = no disabled attr)
  await submitLocator.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const disabled = await submitLocator.getAttribute('disabled').catch(() => null);
    if (disabled === null) break; // disabled attr gone → button enabled
    await page.waitForTimeout(300);
  }
}

export const asVisaHandlers: Partial<Record<JobState, StateHandler>> = {
  [JOB_STATES.LOGIN_PROCESS]: async (ctx) => {
    await ctx.rateLimiter.take();
    await ctx.throttler.beforeAction();
    await ctx.page.goto(ctx.portalConfig.baseUrl, { waitUntil: 'domcontentloaded' });

    // page ready check (mock ortamda stabil)
    await ctx.page.waitForSelector(S.form, { timeout: ctx.portalConfig.timeouts.navigationMs });
  },

  [JOB_STATES.FORM_FILLING]: async (ctx) => {
    const applicantData = (ctx.payload.applicant_data ?? {}) as Record<string, unknown>;
    await fillForm({
      page: ctx.page,
      applicantData,
      throttler: ctx.throttler,
      rateLimiter: ctx.rateLimiter,
    });
  },

  [JOB_STATES.SLOT_SEARCHING]: async (ctx) => {
    const repo = new JobRepository(db.instance);

    const slotCheckOnly = (ctx.payload.config as Record<string, unknown> | undefined)?.slot_check_only === true;

    // Fast-path: scout already found open dates and injected them into applicant_data.
    // Skip portal interaction entirely — no need to re-check /TarihGetir.
    const preloadedDates = (ctx.payload.applicant_data as Record<string, unknown> | undefined)?.open_dates;
    if (!slotCheckOnly && Array.isArray(preloadedDates) && preloadedDates.length > 0) {
      ctx.logger.info({ jobId: ctx.jobId, dateCount: preloadedDates.length }, 'SLOT_SEARCHING: open_dates preloaded by scout, skipping portal check');
      // Do NOT notify again — scout already sent the SLOT FOUND notification.
      // Skip to booking: the form is already filled (FORM_FILLING ran before us).
      // But first select a date + time via datepicker (appointmentTime was not set during fillForm).
      let confirmationNumber: string | undefined;
      let preSubmitDiag: Record<string, unknown> = {};
      let slotSelectedResult: { selected: boolean; appointmentDate?: string; appointmentTime?: string } = { selected: false };
      try {
        slotSelectedResult = await selectSlotForBooking(ctx.page, ctx.logger);
        ctx.logger.info({ slotSelected: slotSelectedResult }, 'SLOT_SEARCHING: selectSlotForBooking result (preloaded path)');
        if (!slotSelectedResult.selected) {
          ctx.logger.warn({ jobId: ctx.jobId }, 'selectSlotForBooking failed (preloaded path), halting at SLOT_FOUND');
          throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
        }

        // Security code check — mirrors slotHunt normal path exactly.
        // If portal rendered enteredCode input (showSecurityCode: true), agent must fill it.
        // Browser context stays open: we inline-wait for the operator to resolve the HITL
        // (waitForHitlResolution polls DB until resolved, then returns the entered code).
        // This avoids a page reload → new random code → stale code mismatch.
        const codeInput = ctx.page.locator(S.inputs.enteredCode);
        const codeInputExists = await codeInput.count().then((n) => n > 0).catch(() => false);
        if (codeInputExists) {
          // Take a screenshot and trigger HITL — wait inline for operator to enter the code.
          const screenshotFilename = 'SLOT_SEARCHING_security_code.png';
          const screenshotUrl = `/cp/screenshots/${ctx.jobId}/${screenshotFilename}`;
          try {
            await codeInput.scrollIntoViewIfNeeded().catch(() => {});
            await ctx.page.waitForTimeout(300);
            const buf = await ctx.page.screenshot({ type: 'png' });
            await uploadScreenshotToCp(ctx.tenantId, ctx.jobId, screenshotFilename, buf);
          } catch (err) {
            ctx.logger.warn({ err, jobId: ctx.jobId }, 'Screenshot upload failed for security code HITL');
          }
          const prompt = 'Enter the 6-digit security code (6 Haneli Kod) shown on the page.';
          const hitlExpiresSeconds = ctx.portalConfig.hitl.maxWaitSeconds > 0 ? ctx.portalConfig.hitl.maxWaitSeconds : undefined;
          const enteredCode = await waitForHitlResolution({
            job_id: ctx.jobId,
            job_run_id: ctx.jobRunId,
            tenant_id: ctx.tenantId,
            type: 'SECURITY_CODE',
            context: {
              prompt,
              screenshot_url: screenshotUrl,
              input_type: 'text',
              metadata: { state: JOB_STATES.SLOT_SEARCHING, selector: 'input[name="enteredCode"]' },
            },
            timeoutSeconds: hitlExpiresSeconds,
            fromState: JOB_STATES.SLOT_SEARCHING,
            workerId: ctx.workerId,
            logger: ctx.logger,
          });
          if (!enteredCode) {
            ctx.logger.warn({ jobId: ctx.jobId }, 'HITL resolved but no code provided — aborting');
            throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
          }
          await ctx.rateLimiter.take();
          await ctx.throttler.beforeAction();
          await codeInput.fill(enteredCode);
          ctx.logger.info({ jobId: ctx.jobId }, 'Security code filled after inline HITL resolution (preloaded path)');
        }

        await ctx.rateLimiter.take();
        await ctx.throttler.beforeAction();

        // Min-run-duration: wait here (before submit) until the configured minimum
        // session time has elapsed. This includes HITL wait time — the intent is that
        // the whole session (automation + human interaction) meets the minimum duration.
        // Scout jobs are exempt (they run as fast as possible).
        const isScoutJob = (ctx.payload.config as Record<string, unknown> | undefined)?.slot_check_only === true;
        const minRunMs = ctx.portalConfig.minRunDurationMs;
        if (!isScoutJob && minRunMs && minRunMs > 0 && ctx.jobStartMs > 0) {
          const elapsed = Date.now() - ctx.jobStartMs;
          if (elapsed < minRunMs) {
            const waitMs = minRunMs - elapsed;
            ctx.logger.info({ jobId: ctx.jobId, waitMs, minRunDurationMs: minRunMs, elapsed }, 'Min run duration not met — holding before submit');
            await new Promise((r) => setTimeout(r, waitMs));
          }
        }

        // CAPTCHA auto-solve bekleme: submit disabled iken bekle (turnstile enable olunca click)
        await waitForSubmitReady(ctx.page, 15_000);
        // Pre-submit diagnostic: log ALL required form field values to catch validation mismatches
        preSubmitDiag = await ctx.page.evaluate(() => {
          const g = (sel: string) => (document.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '(missing)';
          return {
            cfToken: g('[name="cfToken"]'),
            nationality: g('#NationalityTabID'),
            appointment: g('#AppointmentTabID'),
            travelSubject: g('[name="TravelSubject"]'),
            travelDate: g('[name="TravelDate"]'),
            appointmentDate: g('#datepicker'),
            appointmentTime: g('#AppointmentTime'),
            email: g('[name="Email"]'),
            reEmail: g('[name="reEmail"]'),
            tcKimlik: g('[name="TcKimlikNo"]'),
            reTCKN: g('[name="reTCKN"]'),
          };
        }).catch(() => ({}));
        ctx.logger.info({ jobId: ctx.jobId, ...preSubmitDiag }, 'Submit ready (preloaded path), clicking');
        // HTML dump: capture full page HTML just before submit for post-mortem analysis
        try {
          const html = await ctx.page.content();
          await uploadHtmlDumpToCp(ctx.tenantId, ctx.jobId, 'pre-submit-preloaded.html', html);
        } catch (e) {
          ctx.logger.warn({ err: e }, 'Pre-submit HTML dump upload failed (preloaded path)');
        }
        await ctx.page.click(S.submit);
        ctx.logger.info({ jobId: ctx.jobId }, 'Waiting for Swal dialog (preloaded path)');
        const swal = ctx.page.locator(S.swalConfirm);
        const dialogVisible = await swal.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
        ctx.logger.info({ jobId: ctx.jobId, dialogVisible }, 'Swal dialog check (preloaded path)');
        if (dialogVisible) {
          // Confirm Swal'ı mı, error Swal'ı mı? Cancel butonu varsa confirm Swal'dır.
          const hasCancelBtn = await ctx.page.locator('.swal2-cancel').isVisible().catch(() => false);
          if (hasCancelBtn) {
            // Confirm Swal "UYARI!" — Evet'e tıkla ve navigation'ı bekle (Promise.all garantiler)
            ctx.logger.info({ jobId: ctx.jobId }, 'Swal Evet clicking — waiting for navigation (preloaded path)');
            await Promise.all([
              ctx.page.waitForNavigation({ waitUntil: 'load', timeout: 45_000 }),
              swal.click(),
            ]);
            ctx.logger.info({ jobId: ctx.jobId, url: ctx.page.url() }, 'Navigation complete (preloaded path)');
            await dumpPostBookingArtifacts(ctx.page, ctx.tenantId, ctx.jobId, ctx.logger);
          } else {
            // Error Swal — form validation failed; close it and throw fast
            const swalText = await ctx.page.locator('.swal2-html-container, .swal2-content').textContent().catch(() => '');
            await swal.click().catch(() => {});
            ctx.logger.warn({ jobId: ctx.jobId, swalText }, 'Form validation error Swal (preloaded path) — booking failed');
            throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
          }
        } else {
          ctx.logger.warn({ jobId: ctx.jobId }, 'Swal did not appear — form may have submitted directly or validation failed (preloaded path)');
          await dumpPostBookingArtifacts(ctx.page, ctx.tenantId, ctx.jobId, ctx.logger);
        }
        // Randevu Al butonuna tıklandı ve navigation/Swal adımları tamamlandı.
        // Confirmation number okumaya çalış ama başarısız olsa bile COMPLETED say.
        confirmationNumber = await readConfirmationNumber(ctx.page);
        ctx.logger.info({ jobId: ctx.jobId, confirmationNumber }, 'Confirmation number read (preloaded path)');
      } catch (err) {
        // FSMHalt thrown intentionally (e.g. HITL escalation) — must propagate, not be swallowed.
        if (err instanceof FSMHalt) throw err;
        // HITL expired: job is already at HITL_EXPIRED in DB (handler wrote it) — halt there.
        if (err instanceof HitlExpiredError) {
          ctx.logger.warn({ err, jobId: ctx.jobId }, 'HITL expired — job parked at HITL_EXPIRED');
          throw new FSMHalt({ lastState: JOB_STATES.HITL_EXPIRED });
        }
        ctx.logger.warn({ err, jobId: ctx.jobId }, 'Book step failed (preloaded path), halting at SLOT_FOUND');
        throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
      }
      // Submit tıklandı → randevu alındı kabul et; confirmation number varsa ekle, yoksa da COMPLETED.
      ctx.logger.info({ jobId: ctx.jobId, confirmationNumber }, 'Appointment booked (preloaded path)');
      throw new FSMHalt({
        lastState: JOB_STATES.COMPLETED,
        confirmationNumber,
        meta: buildBookingMeta(
          preSubmitDiag as Record<string, unknown>,
          (ctx.payload.applicant_data ?? {}) as Record<string, unknown>,
          preloadedDates,
          slotSelectedResult,
        ),
      });
    }

    // shouldAbort: DB'ye her poll'da değil, 30s'de bir kontrol et (cancel latency kabul edilebilir)
    let lastAbortCheckAt = 0;
    const ABORT_CHECK_INTERVAL_MS = 30_000;
    const res = await slotHunt({
      page: ctx.page,
      baseUrl: ctx.portalConfig.baseUrl,
      throttler: ctx.throttler,
      rateLimiter: ctx.rateLimiter,
      slotHunt: ctx.portalConfig.slotHunt ?? {
        maxPolls: 12,
        pollDelayMinMs: 1500,
        pollDelayMaxMs: 3000,
      },
      shouldAbort: async () => {
        const now = Date.now();
        if (now - lastAbortCheckAt < ABORT_CHECK_INTERVAL_MS) return false;
        lastAbortCheckAt = now;
        const j = await repo.findById(ctx.jobId);
        return j?.status === JOB_STATES.CANCELLED;
      },
      applicantData: (ctx.payload.applicant_data ?? {}) as Record<string, unknown>,
      slotCheckOnly,
      logger: ctx.logger,
    });

    // Security code or blocked (captcha/cloudflare): for slot-check-only we abort and retry; else HITL
    if (res.needsHitl) {
      if (slotCheckOnly) {
        ctx.logger.info({ jobId: ctx.jobId, reason: res.reason }, 'Slot check aborted (security code or blocked); will retry');
        throw new FSMHalt({
          lastState: JOB_STATES.SLOT_SEARCHING,
          slotCheckAborted: true,
          abortReason: res.reason === 'blocked' ? 'blocked' : 'security_code',
        });
      }
      // Normal booking job: inline HITL wait — browser stays open, no page reload.
      // slotHunt already has the page loaded; operator enters the code, we fill it and re-run slotHunt.
      const isBlocked = res.reason === 'blocked';
      const screenshotFilename = isBlocked ? 'SLOT_SEARCHING_blocked.png' : 'SLOT_SEARCHING_security_code.png';
      const screenshotUrl = `/cp/screenshots/${ctx.jobId}/${screenshotFilename}`;
      try {
        const codeInput = ctx.page.locator(S.inputs.enteredCode);
        await codeInput.scrollIntoViewIfNeeded().catch(() => {});
        await ctx.page.waitForTimeout(300);
        const buf = await ctx.page.screenshot({ type: 'png' });
        await uploadScreenshotToCp(ctx.tenantId, ctx.jobId, screenshotFilename, buf);
      } catch (err) {
        ctx.logger.warn({ err, jobId: ctx.jobId }, 'Screenshot upload failed for HITL');
      }
      const prompt = isBlocked
        ? 'The portal appears to be blocking the agent. Check the screenshot and enter any required value or "unblocked" once resolved.'
        : 'Enter the 6-digit security code (6 Haneli Kod) shown on the page.';
      const hitlExpiresSeconds = ctx.portalConfig.hitl.maxWaitSeconds > 0 ? ctx.portalConfig.hitl.maxWaitSeconds : undefined;
      let enteredCode: string;
      try {
        enteredCode = await waitForHitlResolution({
          job_id: ctx.jobId,
          job_run_id: ctx.jobRunId,
          tenant_id: ctx.tenantId,
          type: isBlocked ? 'MANUAL_REVIEW' : 'SECURITY_CODE',
          context: {
            prompt,
            screenshot_url: screenshotUrl,
            input_type: 'text',
            metadata: { state: JOB_STATES.SLOT_SEARCHING, selector: 'input[name="enteredCode"]' },
          },
          timeoutSeconds: hitlExpiresSeconds,
          fromState: JOB_STATES.SLOT_SEARCHING,
          workerId: ctx.workerId,
          logger: ctx.logger,
        });
      } catch (err) {
        if (err instanceof HitlExpiredError) {
          ctx.logger.warn({ err, jobId: ctx.jobId }, 'HITL expired — job parked at HITL_EXPIRED');
          throw new FSMHalt({ lastState: JOB_STATES.HITL_EXPIRED });
        }
        throw err;
      }
      if (!isBlocked && enteredCode) {
        // Fill the security code on the still-open page and re-run slotHunt
        const codeInput = ctx.page.locator(S.inputs.enteredCode);
        const stillExists = await codeInput.count().then((n) => n > 0).catch(() => false);
        if (stillExists) {
          await ctx.rateLimiter.take();
          await ctx.throttler.beforeAction();
          await codeInput.fill(enteredCode);
          ctx.logger.info({ jobId: ctx.jobId }, 'Security code filled after inline HITL (normal path) — re-running slotHunt');
        }
      }
      // Re-run slotHunt now that the code is filled (or operator unblocked manually)
      // Fall through to the slotHunt call below by looping — use recursion via a local retry flag
      // instead of goto. Simplest: just re-call slotHunt and re-evaluate result.
      const res2 = await slotHunt({
        page: ctx.page,
        baseUrl: ctx.portalConfig.baseUrl,
        throttler: ctx.throttler,
        rateLimiter: ctx.rateLimiter,
        slotHunt: ctx.portalConfig.slotHunt ?? { maxPolls: 12, pollDelayMinMs: 1500, pollDelayMaxMs: 3000 },
        shouldAbort: async () => {
          const j = await repo.findById(ctx.jobId);
          return j?.status === JOB_STATES.CANCELLED;
        },
        applicantData: (ctx.payload.applicant_data ?? {}) as Record<string, unknown>,
        slotCheckOnly: false,
        logger: ctx.logger,
      });
      if (res2.needsHitl || !res2.found) {
        ctx.logger.warn({ jobId: ctx.jobId, reason: res2.reason }, 'slotHunt still failed after HITL resolve — halting at WAITING_SLOT');
        throw new FSMHalt({ lastState: JOB_STATES.WAITING_SLOT });
      }
      // Slot found after HITL resolution — proceed to booking below by reassigning res
      // We can't reassign res (const), so inline the booking logic here.
      ctx.logger.info({ jobId: ctx.jobId, dates: res2.dates }, 'Slot found after HITL resolution (normal path)');
      await notifySlotFound({
        jobId: ctx.jobId,
        jobRunId: ctx.jobRunId,
        portalId: ctx.portalConfig.portalId,
        tenantId: ctx.tenantId,
        baseUrl: ctx.portalConfig.baseUrl,
        dates: res2.dates ?? [],
        payload: ctx.payload,
        logger: ctx.logger,
      });
      let confirmationNumberPost: string | undefined;
      let preSubmitDiagPost: Record<string, unknown> = {};
      try {
        await ctx.rateLimiter.take();
        await ctx.throttler.beforeAction();
        await waitForSubmitReady(ctx.page, 15_000);
        preSubmitDiagPost = await ctx.page.evaluate(() => {
          const g = (sel: string) => (document.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
          return {
            nationality: g('#NationalityTabID'),
            appointment: g('#AppointmentTabID'),
            travelSubject: g('[name="TravelSubject"]'),
            travelDate: g('[name="TravelDate"]'),
            appointmentDate: g('#datepicker'),
            appointmentTime: g('#AppointmentTime'),
          };
        }).catch(() => ({}));
        // HTML dump: capture full page HTML just before submit for post-mortem analysis
        try {
          const html = await ctx.page.content();
          await uploadHtmlDumpToCp(ctx.tenantId, ctx.jobId, 'pre-submit-post-hitl.html', html);
        } catch (e) {
          ctx.logger.warn({ err: e }, 'Pre-submit HTML dump upload failed (post-HITL normal path)');
        }
        await ctx.page.click(S.submit);
        const swal2 = ctx.page.locator(S.swalConfirm);
        const dlgVisible2 = await swal2.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
        if (dlgVisible2) {
          const hasCancelBtn2 = await ctx.page.locator('.swal2-cancel').isVisible().catch(() => false);
          if (hasCancelBtn2) {
            await Promise.all([
              ctx.page.waitForNavigation({ waitUntil: 'load', timeout: 45_000 }),
              swal2.click(),
            ]);
            await dumpPostBookingArtifacts(ctx.page, ctx.tenantId, ctx.jobId, ctx.logger);
          } else {
            const swalText2 = await ctx.page.locator('.swal2-html-container, .swal2-content').textContent().catch(() => '');
            await swal2.click().catch(() => {});
            ctx.logger.warn({ jobId: ctx.jobId, swalText: swalText2 }, 'Form validation error Swal (post-HITL normal path)');
            throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
          }
        } else {
          await dumpPostBookingArtifacts(ctx.page, ctx.tenantId, ctx.jobId, ctx.logger);
        }
        confirmationNumberPost = await readConfirmationNumber(ctx.page);
      } catch (err) {
        if (err instanceof FSMHalt) throw err;
        ctx.logger.warn({ err, jobId: ctx.jobId }, 'Book step failed (post-HITL normal path)');
        throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
      }
      ctx.logger.info({ jobId: ctx.jobId, confirmationNumber: confirmationNumberPost }, 'Appointment booked (post-HITL normal path)');
      throw new FSMHalt({
        lastState: JOB_STATES.COMPLETED,
        confirmationNumber: confirmationNumberPost,
        meta: buildBookingMeta(
          preSubmitDiagPost,
          (ctx.payload.applicant_data ?? {}) as Record<string, unknown>,
          res2.dates,
        ),
      });
    }

    if (res.found) {
      ctx.logger.info({ jobId: ctx.jobId, dates: res.dates }, 'Slot found');

      if (slotCheckOnly) {
        // Scout job: notify ops and ask CP to create customer jobs; do not book
        await notifySlotFound({
          jobId: ctx.jobId,
          jobRunId: ctx.jobRunId,
          portalId: ctx.portalConfig.portalId,
          tenantId: ctx.tenantId,
          baseUrl: ctx.portalConfig.baseUrl,
          dates: res.dates ?? [],
          payload: ctx.payload,
          logger: ctx.logger,
        });
        // Pass triggered_by from scout job config so CP routes booking jobs correctly:
        //   'manual'       → SYNC agent (operator watching)
        //   'watcher_auto' → ASYNC queue (background, default)
        const triggeredBy = (ctx.payload.config as Record<string, unknown> | undefined)?.triggered_by as 'manual' | 'watcher_auto' | undefined;
        const triggeredByName = (ctx.payload.config as Record<string, unknown> | undefined)?.triggered_by_name as string | undefined;
        const slotOpenResult = await callSlotOpen(ctx.tenantId, ctx.portalConfig.portalId, res.dates ?? [], ctx.jobId, triggeredBy ?? 'watcher_auto', triggeredByName);
        ctx.logger.info({ jobId: ctx.jobId, jobsCreated: slotOpenResult?.jobs_created, skipped: slotOpenResult?.skipped }, 'Slot-open: customer jobs created');
        throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND, meta: { slot_check: true, jobs_created: slotOpenResult?.jobs_created } });
      }

      await notifySlotFound({
        jobId: ctx.jobId,
        jobRunId: ctx.jobRunId,
        portalId: ctx.portalConfig.portalId,
        tenantId: ctx.tenantId,
        baseUrl: ctx.portalConfig.baseUrl,
        dates: res.dates ?? [],
        payload: ctx.payload,
        logger: ctx.logger,
      });

      // Book appointment: click "Randevu Al" (submit), handle confirm dialog if present, wait for confirmation page
      let confirmationNumber: string | undefined;
      let preSubmitDiag: Record<string, unknown> = {};
      try {
        await ctx.rateLimiter.take();
        await ctx.throttler.beforeAction();
        // CAPTCHA auto-solve bekleme: submit disabled iken bekle (turnstile enable olunca click)
        await waitForSubmitReady(ctx.page, 15_000);
        // Pre-submit diagnostic: log ALL required form field values to catch validation mismatches
        preSubmitDiag = await ctx.page.evaluate(() => {
          const g = (sel: string) => (document.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '(missing)';
          return {
            cfToken: g('[name="cfToken"]'),
            nationality: g('#NationalityTabID'),
            appointment: g('#AppointmentTabID'),
            travelSubject: g('[name="TravelSubject"]'),
            travelDate: g('[name="TravelDate"]'),
            appointmentDate: g('#datepicker'),
            appointmentTime: g('#AppointmentTime'),
            email: g('[name="Email"]'),
            reEmail: g('[name="reEmail"]'),
            tcKimlik: g('[name="TcKimlikNo"]'),
            reTCKN: g('[name="reTCKN"]'),
          };
        }).catch(() => ({}));
        ctx.logger.info({ jobId: ctx.jobId, ...preSubmitDiag }, 'Submit ready (normal path), clicking');
        // HTML dump: capture full page HTML just before submit for post-mortem analysis
        try {
          const html = await ctx.page.content();
          await uploadHtmlDumpToCp(ctx.tenantId, ctx.jobId, 'pre-submit-normal.html', html);
        } catch (e) {
          ctx.logger.warn({ err: e }, 'Pre-submit HTML dump upload failed (normal path)');
        }
        await ctx.page.click(S.submit);
        ctx.logger.info({ jobId: ctx.jobId }, 'Waiting for Swal dialog (normal path)');
        const swal = ctx.page.locator(S.swalConfirm);
        const dialogVisible = await swal.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
        ctx.logger.info({ jobId: ctx.jobId, dialogVisible }, 'Swal dialog check (normal path)');
        if (dialogVisible) {
          // Confirm Swal'ı mı, error Swal'ı mı? Cancel butonu varsa confirm Swal'dır.
          const hasCancelBtn = await ctx.page.locator('.swal2-cancel').isVisible().catch(() => false);
          if (hasCancelBtn) {
            // Confirm Swal "UYARI!" — Evet'e tıkla ve navigation'ı bekle (Promise.all garantiler)
            ctx.logger.info({ jobId: ctx.jobId }, 'Swal Evet clicking — waiting for navigation (normal path)');
            await Promise.all([
              ctx.page.waitForNavigation({ waitUntil: 'load', timeout: 45_000 }),
              swal.click(),
            ]);
            ctx.logger.info({ jobId: ctx.jobId, url: ctx.page.url() }, 'Navigation complete (normal path)');
            await dumpPostBookingArtifacts(ctx.page, ctx.tenantId, ctx.jobId, ctx.logger);
          } else {
            // Error Swal — form validation failed; close it and throw fast
            const swalText = await ctx.page.locator('.swal2-html-container, .swal2-content').textContent().catch(() => '');
            await swal.click().catch(() => {});
            ctx.logger.warn({ jobId: ctx.jobId, swalText }, 'Form validation error Swal (normal path) — booking failed');
            throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
          }
        } else {
          ctx.logger.warn({ jobId: ctx.jobId }, 'Swal did not appear — form may have submitted directly or validation failed (normal path)');
          await dumpPostBookingArtifacts(ctx.page, ctx.tenantId, ctx.jobId, ctx.logger);
        }
        // Randevu Al butonuna tıklandı ve navigation/Swal adımları tamamlandı.
        // Confirmation number okumaya çalış ama başarısız olsa bile COMPLETED say.
        confirmationNumber = await readConfirmationNumber(ctx.page);
        ctx.logger.info({ jobId: ctx.jobId, confirmationNumber }, 'Confirmation number read (normal path)');
      } catch (err) {
        // FSMHalt thrown intentionally (e.g. HITL escalation) — must propagate, not be swallowed.
        if (err instanceof FSMHalt) throw err;
        ctx.logger.warn({ err, jobId: ctx.jobId }, 'Book step failed, halting at SLOT_FOUND');
        throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
      }

      // Submit tıklandı → randevu alındı kabul et; confirmation number varsa ekle, yoksa da COMPLETED.
      ctx.logger.info({ jobId: ctx.jobId, confirmationNumber }, 'Appointment booked');
      throw new FSMHalt({
        lastState: JOB_STATES.COMPLETED,
        confirmationNumber,
        meta: buildBookingMeta(
          preSubmitDiag as Record<string, unknown>,
          (ctx.payload.applicant_data ?? {}) as Record<string, unknown>,
          res.dates,
        ),
      });
    }

    // no slot → complete this job (one job = one slot check); watcher/scheduler creates new job for next check
    const prev = await getSlotStatus(ctx.jobId);
    await setSlotStatus(ctx.jobId, 'closed');
    if (prev === 'open') {
      await notifySlotClosed({
        jobId: ctx.jobId,
        jobRunId: ctx.jobRunId,
        portalId: ctx.portalConfig.portalId,
        tenantId: ctx.tenantId,
        baseUrl: ctx.portalConfig.baseUrl,
        logger: ctx.logger,
      });
    }
    if (res.reason === 'open_days_but_no_times' || res.reason === 'tarihgetir_timeout') {
      const screenshotFilename =
        res.reason === 'tarihgetir_timeout'
          ? 'SLOT_SEARCHING_tarihgetir_timeout.png'
          : 'SLOT_SEARCHING_open_days_no_times.png';
      try {
        await ctx.rateLimiter.take();
        await ctx.throttler.beforeAction();
        const buf = await ctx.page.screenshot({ type: 'png' });
        await uploadScreenshotToCp(ctx.tenantId, ctx.jobId, screenshotFilename, buf);
        const screenshotUrl = `/cp/screenshots/${ctx.jobId}/${screenshotFilename}`;
        ctx.logger.info({ jobId: ctx.jobId, reason: res.reason, screenshot_url: screenshotUrl }, 'No slot: evidence screenshot saved');
      } catch (err) {
        ctx.logger.warn({ err, jobId: ctx.jobId, reason: res.reason }, 'Evidence screenshot upload failed');
      }
    }
    // Scout (slot_check_only): one job = one check → job completes; watcher creates new job. Normal agents: WAITING_SLOT + retry same job.
    if (slotCheckOnly) {
      ctx.logger.info({ jobId: ctx.jobId, reason: res.reason }, 'No slot found; completing job');
      throw new FSMHalt({ lastState: JOB_STATES.COMPLETED, slotFound: false });
    }
    ctx.logger.info({ jobId: ctx.jobId, reason: res.reason }, 'No slot found, waiting (retry same job)');
    throw new FSMHalt({ lastState: JOB_STATES.WAITING_SLOT });
  },
};
