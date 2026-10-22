import { chromium, devices } from 'playwright';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let browserPromise = null;

const DEVICE_PROFILES = {
  desktop: { viewport: { width: 1366, height: 768 } },
  mobile: devices['Pixel 7'],
};

export const SUPPORTED_DEVICES = Object.keys(DEVICE_PROFILES);

function getBrowser() {
  if (!browserPromise) {
    logger.info(`Launching Chromium (headless=${config.browser.headless})`);
    browserPromise = chromium
      .launch({ headless: config.browser.headless, args: ['--autoplay-policy=no-user-gesture-required'] })
      .then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

export async function newContext(device) {
  const browser = await getBrowser();
  return browser.newContext({
    ...DEVICE_PROFILES[device],
    serviceWorkers: 'block',
  });
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close();
}
