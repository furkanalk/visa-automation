import { chromium, type Browser } from 'playwright';

let browser: Browser | null = null;

/** Whether a browser instance has been launched (for health checks). */
export function isBrowserLaunched(): boolean {
  return browser !== null;
}

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}