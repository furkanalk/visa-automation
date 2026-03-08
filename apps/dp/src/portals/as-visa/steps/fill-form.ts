import type { Page } from 'playwright';
import type { Throttler } from '../../../core/networking/throttler.js';
import type { RateLimiter } from '../../../core/networking/rate-limiter.js';
import { AS_VISA_SELECTORS as S } from '../pages/make-appointment/index.js';
import { buildAsVisaFormValues } from './form-values.js';
import { setDateInput } from './date-input.js';

export interface FillFormArgs {
  page: Page;
  applicantData: Record<string, unknown>;
  throttler: Throttler;
  rateLimiter: RateLimiter;
}

/**
 * Fills the AS-VISA make-appointment form using customer data (Visa Information + portal-specific preferences).
 * Uses buildAsVisaFormValues to map applicant_data to selector keys, then fills inputs and selects.
 */
export async function fillForm(args: FillFormArgs): Promise<void> {
  const { page, applicantData, throttler, rateLimiter } = args;
  const formValues = buildAsVisaFormValues(applicantData);

  await rateLimiter.take();
  await throttler.beforeAction();
  await page.waitForSelector(S.form, { timeout: 15_000 });

  // Fill selects (nationality, appointment, travelSubject, appointmentTime)
  const selectKeys = ['nationality', 'appointment', 'travelSubject', 'appointmentTime'] as const;
  for (const key of selectKeys) {
    const value = formValues[key];
    if (!value) continue;
    const selector = S.selects[key];
    try {
      await throttler.beforeAction();
      await page.selectOption(selector, value);
    } catch {
      // Option might not exist or element not visible; skip
    }
  }

  // Date inputs may be readonly (datepicker); use setDateInput so we don't timeout on fill()
  const dateInputKeys = ['travelDate', 'appointmentDate'] as const;
  for (const key of dateInputKeys) {
    const value = formValues[key];
    if (value === undefined || value === '') continue;
    const selector = S.inputs[key];
    try {
      await throttler.beforeAction();
      await setDateInput(page, selector, value);
    } catch {
      // Element might not be visible yet (e.g. depends on previous selects); skip
    }
  }

  // Fill remaining inputs (passportNumber, name, surname, tcKimlikNo, reTckn, dogumYili, phone, email, reEmail)
  const inputKeys = [
    'passportNumber',
    'name',
    'surname',
    'tcKimlikNo',
    'reTckn',
    'dogumYili',
    'phone',
    'email',
    'reEmail',
  ] as const;
  for (const key of inputKeys) {
    const value = formValues[key];
    if (value === undefined || value === '') continue;
    const selector = S.inputs[key];
    try {
      await throttler.beforeAction();
      await page.fill(selector, value);
    } catch {
      // Element might not be visible yet (e.g. depends on previous selects); skip
    }
  }
}
