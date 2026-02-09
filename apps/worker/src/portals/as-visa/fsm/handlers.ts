import type { JobState } from '@visa-automation/shared';
import { JOB_STATES } from '@visa-automation/shared';
import { FSMHalt } from '../../../core/fsm/runner.js';
import type { StateHandler } from '../../../core/fsm/runner.js';
import { slotHunt } from '../steps/slot-hunt.js';
import { AS_VISA_SELECTORS as S } from '../selectors.js';
import { notifySlotFound } from '../../../core/notify/index.js';

export const asVisaHandlers: Partial<Record<JobState, StateHandler>> = {
  [JOB_STATES.LOGIN_PROCESS]: async (ctx) => {
    await ctx.rateLimiter.take();
    await ctx.throttler.beforeAction();
    await ctx.page.goto(ctx.portalConfig.baseUrl, { waitUntil: 'domcontentloaded' });

    // page ready check (mock ortamda stabil)
    await ctx.page.waitForSelector(S.form, { timeout: ctx.portalConfig.timeouts.navigationMs });
  },

  [JOB_STATES.SLOT_SEARCHING]: async (ctx) => {
    const res = await slotHunt({
      page: ctx.page,
      baseUrl: ctx.portalConfig.baseUrl,
      throttler: ctx.throttler,
      rateLimiter: ctx.rateLimiter,
    });

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

      // Slot bulundu: bu vertical-slice'ta otomatik "booking" yok.
      // Job'u SLOT_FOUND state'inde durduruyoruz (manual pickup / next stage).
      throw new FSMHalt({ lastState: JOB_STATES.SLOT_FOUND });
    }

    // slot yok → FSM WAITING_SLOT'a geçecek
    ctx.logger.info({ jobId: ctx.jobId }, 'No slot found, waiting');
  },
};
