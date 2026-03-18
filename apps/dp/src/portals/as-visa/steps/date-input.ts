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
      // Trigger it if jQuery + datepicker are available so portal JS reacts (e.g. shows #apDate,
      // and the #TravelDate changeDate handler sets #datepicker startDate/endDate correctly).
      //
      // IMPORTANT: call datepicker('update') BEFORE triggering changeDate.
      // 'update' parses the current input.value and syncs Bootstrap's internal date state so that
      // datepicker('getDate') returns the correct Date object. Without this, getDate() returns null
      // when the value was set programmatically (not via the widget), and handlers that call
      // getDate() to compute setStartDate/setEndDate would derive epoch-era dates (1969/1970),
      // which blocks all future appointment dates from being shown in the datepicker.
      const g = globalThis as unknown as {
        $?: (sel: string) => {
          data: (k: string) => unknown;
          trigger: (ev: string) => void;
          datepicker: (cmd: string) => void;
        };
      };
      if (g.$ && g.$(arg.selector).data('datepicker')) {
        g.$(arg.selector).datepicker('update');
        g.$(arg.selector).trigger('changeDate');
      }
    },
    { selector, value: ddMmYyyy }
  );
}
