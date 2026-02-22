import type { JobState } from '@visa-automation/shared';
import { JOB_STATES } from '@visa-automation/shared';
import { FSMHalt } from '../../../core/fsm/runner.js';
import type { StateHandler } from '../../../core/fsm/runner.js';
import { slotHunt } from '../steps/slot-hunt.js';
import { fillForm } from '../steps/fill-form.js';
import { AS_VISA_SELECTORS as S } from '../pages/make-appointment/index.js';
import { notifySlotFound, notifySlotClosed } from '../../../core/notify/index.js';
import { getSlotStatus, setSlotStatus } from '../../../core/notify/status.js';
import { uploadScreenshotToCp } from '../../../core/upload-screenshot.js';
import { callSlotOpen } from '../../../core/call-slot-open.js';
import { db, JobRepository } from '@visa-automation/db';

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
        const j = await repo.findById(ctx.jobId);
        return j?.status === JOB_STATES.CANCELLED;
      },
      applicantData: (ctx.payload.applicant_data ?? {}) as Record<string, unknown>,
    });

    // Security code or blocked (captcha/cloudflare): for slot-check-only we abort and retry; else HITL
    if (res.needsHitl) {
      const slotCheckOnly = (ctx.payload.config as Record<string, unknown> | undefined)?.slot_check_only === true;
      if (slotCheckOnly) {
        ctx.logger.info({ jobId: ctx.jobId, reason: res.reason }, 'Slot check aborted (security code or blocked); will retry');
        throw new FSMHalt({
          lastState: JOB_STATES.SLOT_SEARCHING,
          slotCheckAborted: true,
          abortReason: res.reason === 'blocked' ? 'blocked' : 'security_code',
        });
      }
      const screenshotFilename = res.reason === 'blocked' ? 'SLOT_SEARCHING_blocked.png' : 'SLOT_SEARCHING_security_code.png';
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
      const prompt =
        'Enter the 6-digit security code (6 Haneli Kod). The input selector is input[name="enteredCode"]. ' +
        'Enter the value in the resolution field.';
      throw new FSMHalt({
        lastState: JOB_STATES.SLOT_SEARCHING,
        hitlTriggered: true,
        hitlType: 'SECURITY_CODE',
        hitlContext: {
          prompt,
          screenshot_url: screenshotUrl,
          input_type: 'text',
          metadata: { state: JOB_STATES.SLOT_SEARCHING, selector: 'input[name="enteredCode"]' },
        },
      });
    }

    if (res.found) {
      ctx.logger.info({ jobId: ctx.jobId, dates: res.dates }, 'Slot found');
      const slotCheckOnly = (ctx.payload.config as Record<string, unknown> | undefined)?.slot_check_only === true;

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
        const slotOpenResult = await callSlotOpen(ctx.tenantId, ctx.portalConfig.portalId);
        ctx.logger.info({ jobId: ctx.jobId, jobsCreated: slotOpenResult?.jobs_created }, 'Slot-open: customer jobs created');
        throw new FSMHalt({ lastState: JOB_STATES.COMPLETED, meta: { slot_check: true, jobs_created: slotOpenResult?.jobs_created } });
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
      try {
        await ctx.page.click(S.submit);
        const swal = ctx.page.locator(S.swalConfirm);
        const dialogVisible = await swal.isVisible().catch(() => false);
        if (dialogVisible) {
          await swal.click();
        }
        const timeoutMs = ctx.portalConfig.timeouts.navigationMs;
        await ctx.page.locator(S.confirmation.number).first().waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {});
        const el = ctx.page.locator(S.confirmation.number).first();
        const text = await el.getAttribute('data-confirmation').catch(() => null) ?? await el.textContent().catch(() => null);
        if (text) confirmationNumber = text.replace(/^Confirmation:\s*/i, '').trim();
      } catch (err) {
        ctx.logger.warn({ err, jobId: ctx.jobId }, 'Book step failed, halting at SLOT_FOUND');
        throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
      }

      if (confirmationNumber) {
        ctx.logger.info({ jobId: ctx.jobId, confirmationNumber }, 'Appointment booked');
        throw new FSMHalt({
          lastState: JOB_STATES.COMPLETED,
          confirmationNumber,
          meta: { bookedAt: new Date().toISOString(), dates: res.dates },
        });
      }
      throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
    }

    // no slot → FSM will transition to WAITING_SLOT
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
    ctx.logger.info({ jobId: ctx.jobId, reason: res.reason }, 'No slot found, waiting');
  },
};
