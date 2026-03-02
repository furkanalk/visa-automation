import { chromium } from '/home/purple/repos/visa-automation/node_modules/playwright/index.mjs';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://localhost:3004/as-visa', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#apForm', { timeout: 10000 });

// Simulate AppointmentTabID change to trigger TarihGetir
await page.evaluate(() => {
  const el = document.querySelector('#AppointmentTabID');
  if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
});
const resp = await page.waitForResponse(r => r.url().includes('/TarihGetir') && r.status() === 200, { timeout: 10000 }).catch(() => null);
const body = resp ? await resp.text() : 'NO RESPONSE';
console.log('TarihGetir response:', body);

await new Promise(r => setTimeout(r, 500));
const dateDisabled = await page.evaluate(() => globalThis.dateDisabled ?? 'NOT_SET');
console.log('dateDisabled:', JSON.stringify(dateDisabled));

const isReadonly = await page.getAttribute('#datepicker', 'readonly');
console.log('isReadonly:', isReadonly !== null ? 'YES' : 'NO');

// Try clicking datepicker
await page.click('#datepicker').catch(e => console.log('click err:', e.message));
await new Promise(r => setTimeout(r, 800));

const bsPopup = await page.$('.datepicker');
const bsVisible = bsPopup ? await bsPopup.isVisible() : false;
console.log('Bootstrap popup found:', !!bsPopup, 'visible:', bsVisible);

const enabledDays = await page.$$('.datepicker td.day:not(.disabled)');
console.log('Enabled days (.datepicker td.day:not(.disabled)):', enabledDays.length);

const allDays = await page.$$('.datepicker td.day');
console.log('All td.day cells:', allDays.length);
for (const d of allDays.slice(0, 8)) {
  const cls = await d.getAttribute('class');
  const txt = await d.textContent();
  console.log('  day:', (txt?.trim() ?? '').padStart(2), '| class:', cls);
}

if (enabledDays.length > 0) {
  console.log('\n--- Clicking first enabled day ---');
  const firstDay = enabledDays[0];
  const dayTxt = await firstDay.textContent();
  console.log('Clicking day:', dayTxt?.trim());
  await firstDay.click();
  await new Promise(r => setTimeout(r, 1500));
  
  const timeVisible = await page.$('#AppointmentTime').then(el => el ? el.isVisible() : false).catch(() => false);
  console.log('#AppointmentTime visible:', timeVisible);
  
  const appSection = await page.$('#AppTime');
  const appSectionVisible = appSection ? await appSection.isVisible() : false;
  console.log('#AppTime section visible:', appSectionVisible);
  
  if (timeVisible) {
    const opts = await page.$$('#AppointmentTime option');
    console.log('Time options count:', opts.length);
    for (const opt of opts.slice(0, 4)) {
      const val = await opt.getAttribute('value');
      const dis = await opt.getAttribute('disabled');
      console.log('  option value:', val, 'disabled:', dis);
    }
  }
}

await browser.close();
console.log('\nDone.');
