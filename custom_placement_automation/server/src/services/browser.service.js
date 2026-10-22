import { chromium, devices } from 'playwright';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import fs from 'node:fs';

let browserPromise = null;
let closing = false;
export const chromiumInstalled = () => fs.existsSync(chromium.executablePath());

const DEVICE_PROFILES = {
  desktop: { viewport: { width: 1366, height: 768 } },
  mobile: devices['Pixel 7'],
};

export const SUPPORTED_DEVICES = Object.keys(DEVICE_PROFILES);

function getBrowser() {
  if (closing) throw new Error('Browser service is shutting down');
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
  closing = true;
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close();
}
