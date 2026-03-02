import type { Page } from 'playwright';

/**
 * Sets a date input that may be readonly (e.g. #TravelDate).
 * - If the input is not readonly, uses page.fill().
 * - If readonly, sets value via JS and dispatches input/change so site JS can react.
 */
export async function setDateInput(
  page: Page,
  selector: string,
  ddMmYyyy: string
): Promise<void> {
  const isReadonly = (await page.getAttribute(selector, 'readonly')) != null;
  if (!isReadonly) {
    await page.fill(selector, ddMmYyyy);
    return;
  }
  await page.evaluate(
    (arg: { selector: string; value: string }) => {
      const el = document.querySelector(arg.selector);
      if (!el || !('value' in el)) return;
      const input = el as HTMLInputElement;
      input.value = arg.value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // Bootstrap-datepicker listens for 'changeDate' jQuery event (not native change).
      // Trigger it if jQuery + datepicker are available so portal JS reacts (e.g. shows #apDate).
      const g = globalThis as unknown as { $?: (sel: string) => { data: (k: string) => unknown; trigger: (ev: string) => void } };
      if (g.$ && g.$(arg.selector).data('datepicker')) {
        g.$(arg.selector).trigger('changeDate');
      }
    },
    { selector, value: ddMmYyyy }
  );
}
