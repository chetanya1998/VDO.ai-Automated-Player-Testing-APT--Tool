import { chromium, devices } from 'playwright';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import fs from 'node:fs';

let browserPromise = null;
let closing = false;
let readinessPromise = null;
let readinessCheckedAt = 0;
export const chromiumInstalled = () => fs.existsSync(chromium.executablePath());

const CHROME_PATHS = {
  win32: ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].map((name) => process.env[name] && `${process.env[name]}\\Google\\Chrome\\Application\\chrome.exe`),
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
};

export function findChrome() {
  if (config.browser.chromePath) return fs.existsSync(config.browser.chromePath) ? config.browser.chromePath : null;
  return (CHROME_PATHS[process.platform] ?? []).find((file) => file && fs.existsSync(file)) ?? null;
}

// The browser every check uses (placement, deep test and PDF), so all of them behave the same.
export function browserChoice() {
  const chrome = config.browser.channel === 'chromium' ? null : findChrome();
  if (chrome) return { name: 'Google Chrome', executablePath: chrome };
  if (config.browser.channel === 'chrome') return { name: 'Google Chrome', executablePath: null, missing: true };
  return { name: 'Chromium', executablePath: chromium.executablePath() };
}

export const launchOptions = () => {
  const { executablePath } = browserChoice();
  return executablePath === chromium.executablePath() ? { channel: 'chromium' } : { executablePath };
};

const DEVICE_PROFILES = {
  desktop: { viewport: { width: 1366, height: 768 } },
  mobile: devices['Pixel 7'],
};

export const SUPPORTED_DEVICES = Object.keys(DEVICE_PROFILES);

// The same device settings for the deep test's separate browser.
export function deviceContextOptions(device) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = DEVICE_PROFILES[device];
  return Object.fromEntries(Object.entries({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch }).filter(([, value]) => value !== undefined));
}

function getBrowser() {
  if (closing) throw new Error('Browser service is shutting down');
  if (!browserPromise) {
    const choice = browserChoice();
    if (choice.missing) throw new Error('BROWSER_CHANNEL=chrome but Google Chrome was not found. Install Chrome or set CHROME_PATH.');
    logger.info(`Launching ${choice.name} (headless=${config.browser.headless})`);
    browserPromise = chromium
      .launch({ ...launchOptions(), headless: config.browser.headless, timeout: 10000, args: ['--autoplay-policy=no-user-gesture-required'] })
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
      const choice = browserChoice();
      if (choice.missing) return { name: choice.name, installed: false, launchable: false, message: 'Google Chrome was not found. Install Chrome, set CHROME_PATH, or set BROWSER_CHANNEL=auto.' };
      if (choice.name === 'Chromium' && !chromiumInstalled()) return { name: choice.name, installed: false, launchable: false, message: 'Chromium is missing. Run npm --prefix server run browsers:install from custom_placement_automation, then retry.' };
      try {
        const browser = await getBrowser();
        return { name: choice.name, installed: true, launchable: browser.isConnected(), version: browser.version(), mp4: await playsMp4(browser) };
      } catch {
        return { name: choice.name, installed: true, launchable: false, message: `${choice.name} could not start. Check browser permissions and the backend terminal.` };
      }
    })();
  }
  return readinessPromise;
}

// Chromium builds without proprietary codecs cannot play MP4/H.264 ads; Google Chrome can.
async function playsMp4(browser) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    return (await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'))) !== '';
  } catch {
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}

export async function closeBrowser() {
  closing = true;
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close();
}
