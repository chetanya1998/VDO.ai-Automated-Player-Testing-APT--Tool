import { chromium, devices } from 'playwright';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import fs from 'node:fs';

let browserPromise = null;
let closing = false;
let readinessPromise = null;
let readinessCheckedAt = 0;
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
      .launch({ channel: 'chromium', headless: config.browser.headless, timeout: 10000, args: ['--autoplay-policy=no-user-gesture-required'] })
      .then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
          readinessPromise = null;
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

export async function browserReadiness() {
  if (closing) return { installed: chromiumInstalled(), launchable: false, message: 'Browser is shutting down' };
  if (!readinessPromise || Date.now() - readinessCheckedAt > 30000) {
    readinessCheckedAt = Date.now();
    readinessPromise = (async () => {
      if (!chromiumInstalled()) return { installed: false, launchable: false, message: 'Chromium is missing. Run npm --prefix server run browsers:install from custom_placement_automation, then retry.' };
      try {
        const browser = await getBrowser();
        return { installed: true, launchable: browser.isConnected(), version: browser.version() };
      } catch {
        return { installed: true, launchable: false, message: 'Chromium could not start. Check browser permissions and the backend terminal.' };
      }
    })();
  }
  return readinessPromise;
}

export async function closeBrowser() {
  closing = true;
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close();
}
