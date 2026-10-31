import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { chromium, errors, type Browser, type BrowserContextOptions, type LaunchOptions, type Page } from "playwright-core";
import { BrowserCapture, type BrowserCaptureResult, type CaptureLimits } from "../browser/capture.js";
import { DOM_TRACKER_INIT_SCRIPT } from "../browser/dom.js";
import { browserProcessEnvironment, type BrowserObservation, type BrowserRunError } from "../browser/run.js";
import { isPublicNetworkAddress } from "../browser/url-policy.js";

// Deep tests open real publisher pages, which load many third-party ad and analytics origins.
// The APT runner's per-origin allowlist would abort that traffic, so this runner allows public
// internet egress (as the placement checks do) while still refusing private-network addresses.
export const DEEP_EGRESS_BOUNDARY = {
  state: "public_internet_with_private_network_block",
  currentMode: "public_addresses_only",
  unrestrictedRemoteExecution: false,
  enforcedAt: "browser_context_http_and_websocket_routes",
  limitations: ["dns_answers_are_checked_per_hostname_but_not_pinned"],
} as const;

export interface DeepScrollSettings {
  stepViewportRatio: number;
  intervalMs: number;
  maxSteps: number;
}

export interface DeepBrowserRunOptions {
  targetUrl: string;
  browserExecutablePath: string;
  contextOptions: Pick<BrowserContextOptions, "userAgent" | "deviceScaleFactor" | "isMobile" | "hasTouch"> & { viewport: { width: number; height: number } };
  navigationTimeoutMs: number;
  totalTimeoutMs: number;
  observeAfterLoadMs: number;
  visibilitySampleIntervalMs: number;
  scroll?: DeepScrollSettings;
  // loaderOrigin lets local fixtures serve the tag from their own origin instead of *.vdo.ai.
  scriptOverride?: { tagName: string; body: string; loaderOrigin?: string };
  injectCss?: string;
  captureLimits?: Partial<CaptureLimits>;
  // Loopback/private targets are allowed only for local fixture tests.
  allowPrivateNetwork?: boolean;
  // When set, take screenshots aimed at the first element matching playerSelector (in any frame).
  screenshots?: { playerSelector: string; settleMs?: number };
  // When set, sample Google SafeFrame ad iframes and note whether each sits inside the player.
  safeFrames?: { playerSelector: string };
  // When set, after the normal observation keep the player in view this long to watch for an ad slot refresh.
  refreshWatch?: { playerSelector: string; watchMs: number };
}

export interface SafeFrameSample {
  atMs: number;
  url: string;
  width: number;
  height: number;
  visible: boolean;
  inViewport: boolean;
  inPlayer: boolean;
  crossOrigin: boolean;
}

export interface DeepScreenshot {
  label: string;
  jpeg: Buffer;
}

export interface DeepBrowserRunResult {
  status: "completed" | "timed_out" | "runner_error";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  metadata: {
    targetUrl: string;
    finalUrl: string | null;
    browser: "chromium";
    browserVersion: string | null;
    os: NodeJS.Platform;
    viewport: { width: number; height: number };
    coldCache: "new_context";
    networkConditions: "host_default_unshaped";
    egressBoundary: typeof DEEP_EGRESS_BOUNDARY;
  };
  observations: BrowserObservation[];
  capture: BrowserCaptureResult;
  errors: BrowserRunError[];
  scriptOverrideHits: number;
  blockedRequestCount: number;
  screenshots: DeepScreenshot[];
  screenshotNotes: string[];
  safeFrames?: { loaded: Array<{ atMs: number; url: string }>; samples: SafeFrameSample[] };
  // Elapsed milliseconds when the refresh watch started and ended (player kept in view in between).
  refreshWindow?: { startMs: number; endMs: number } | null;
  resourcesClosed: { context: boolean; browser: boolean };
}

export interface DeepBrowserRunnerDependencies {
  launch(options: LaunchOptions): Promise<Browser>;
  resolve(hostname: string): Promise<readonly string[]>;
}

const defaultDependencies: DeepBrowserRunnerDependencies = {
  launch: (options) => chromium.launch(options),
  resolve: async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((item) => item.address),
};

function elapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

function errorRecord(stage: BrowserRunError["stage"], value: unknown): BrowserRunError {
  const error = value instanceof Error ? value : new Error(String(value));
  return { stage, name: error.name, message: error.message };
}

function isBrowserClosure(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value);
  return /browser.*closed|target page.*closed|context.*closed|has been closed|browser has disconnected/i.test(message);
}

function validateOptions(options: DeepBrowserRunOptions): void {
  for (const [name, value] of [
    ["viewport.width", options.contextOptions.viewport.width],
    ["viewport.height", options.contextOptions.viewport.height],
    ["navigationTimeoutMs", options.navigationTimeoutMs],
    ["totalTimeoutMs", options.totalTimeoutMs],
    ["visibilitySampleIntervalMs", options.visibilitySampleIntervalMs],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  }
  if (!Number.isInteger(options.observeAfterLoadMs) || options.observeAfterLoadMs < 0) throw new TypeError("observeAfterLoadMs must be a non-negative integer");
  if (options.browserExecutablePath.trim() === "") throw new TypeError("browserExecutablePath is required");
  const url = new URL(options.targetUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new TypeError("targetUrl must be an HTTP(S) URL without credentials");
}

function bareHostname(hostname: string): string {
  return (hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname).toLowerCase();
}

function isTagScript(value: string, tagName: string, loaderOrigin?: string): boolean {
  try {
    const url = new URL(value);
    const vdoHost = url.hostname === "vdo.ai" || url.hostname.endsWith(".vdo.ai");
    return (vdoHost || url.origin === loaderOrigin) && url.pathname === `/core/${tagName}/vdo.ai.js`;
  } catch {
    return false;
  }
}

function injectStyleScript(css: string): string {
  return `(() => {
  if (window !== window.top) return;
  const style = document.createElement("style");
  style.id = "__deep_check_style";
  style.textContent = ${JSON.stringify(css)};
  const attach = () => {
    if (style.isConnected) return true;
    const parent = document.head || document.documentElement;
    if (!parent) return false;
    parent.appendChild(style);
    return true;
  };
  if (!attach()) {
    const observer = new MutationObserver(() => attach() && observer.disconnect());
    observer.observe(document, { childList: true, subtree: true });
  }
  document.addEventListener("DOMContentLoaded", attach);
  window.addEventListener("load", attach);
})();`;
}

class PublicEgressGuard {
  readonly #decisions = new Map<string, Promise<boolean>>();

  constructor(private readonly resolve: DeepBrowserRunnerDependencies["resolve"], private readonly allowPrivateNetwork: boolean) {}

  async allowed(value: string): Promise<boolean> {
    let url: URL;
    try { url = new URL(value); } catch { return false; }
    if (["data:", "blob:", "about:"].includes(url.protocol)) return true;
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) return false;
    if (this.allowPrivateNetwork) return true;
    const hostname = bareHostname(url.hostname);
    let decision = this.#decisions.get(hostname);
    if (decision === undefined) {
      decision = isIP(hostname) !== 0
        ? Promise.resolve(isPublicNetworkAddress(hostname))
        : this.resolve(hostname).then((addresses) => addresses.length > 0 && addresses.every(isPublicNetworkAddress), () => false);
      this.#decisions.set(hostname, decision);
    }
    return decision;
  }
}

// Screenshots are taken at CSS pixel size so high-density phone screens stay small; failures are notes, never errors.
async function screenshot(page: Page, label: string, shots: DeepScreenshot[], notes: string[]): Promise<void> {
  try {
    const jpeg = await page.screenshot({ type: "jpeg", quality: 70, scale: "css", animations: "disabled", caret: "hide", timeout: 10_000 });
    // A page too short to scroll gives the same picture again; keep only the first one.
    if (!shots.at(-1)?.jpeg.equals(jpeg)) shots.push({ label, jpeg });
  } catch (error) {
    notes.push(`${label}: screenshot failed (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`);
  }
}

async function capturePlayerScreenshots(page: Page, options: NonNullable<DeepBrowserRunOptions["screenshots"]>, shots: DeepScreenshot[], notes: string[]): Promise<void> {
  const settle = () => page.waitForTimeout(options.settleMs ?? 1_500);
  await screenshot(page, "End of observation (deep test)", shots, notes);
  let player = null;
  for (const frame of [page.mainFrame(), ...page.frames().filter((item) => item !== page.mainFrame() && !item.isDetached())]) {
    const candidate = frame.locator(options.playerSelector).first();
    if (await candidate.count().catch(() => 0) > 0) { player = candidate; break; }
  }
  if (player === null) {
    notes.push("The player was not found on the page, so no player screenshot was taken.");
    return;
  }
  const bottom = await player.evaluate((element) => {
    element.scrollIntoView({ block: "center", behavior: "instant" });
    return element.getBoundingClientRect().bottom;
  }).catch(() => null);
  await settle();
  await screenshot(page, "Player in view (deep test)", shots, notes);
  await page.evaluate((value) => window.scrollBy({ top: Math.max(window.innerHeight * 0.5, (value ?? window.innerHeight) + window.innerHeight * 0.25), behavior: "instant" }), bottom).catch(() => undefined);
  await settle();
  await screenshot(page, "Scrolled past player (floating, deep test)", shots, notes);
}

// Google serves SafeFrame ads from <hash>.safeframe.googlesyndication.com (or a /safeframe/ path on its ad hosts).
export function isSafeFrameUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return host === "safeframe.googlesyndication.com" || host.endsWith(".safeframe.googlesyndication.com")
      || (/(^|\.)(googlesyndication|doubleclick)\.(com|net)$/.test(host) && url.pathname.includes("/safeframe/"));
  } catch {
    return false;
  }
}

async function sampleSafeFrames(page: Page, playerSelector: string, atMs: number, samples: SafeFrameSample[]): Promise<void> {
  const main = page.mainFrame();
  const pageOrigin = (() => { try { return new URL(page.url()).origin; } catch { return ""; } })();
  for (const frame of page.frames()) {
    if (frame === main || frame.isDetached() || !isSafeFrameUrl(frame.url())) continue;
    try {
      const element = await frame.frameElement();
      const box = await element.boundingBox();
      const visible = box !== null && await element.evaluate((node) => {
        const style = getComputedStyle(node as Element);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0;
      });
      // Walk up through nested frames until the player wrapper is found or the top page is reached.
      let inPlayer = false;
      let current = frame;
      let currentElement = element;
      for (let depth = 0; depth < 6; depth += 1) {
        if (await currentElement.evaluate((node, selector) => (node as Element).closest(selector) !== null, playerSelector).catch(() => false)) { inPlayer = true; break; }
        const parent = current.parentFrame();
        if (parent === null || parent === main) break;
        currentElement = await parent.frameElement();
        current = parent;
      }
      const viewport = page.viewportSize();
      const inViewport = box !== null && viewport !== null && box.width > 0 && box.height > 0
        && box.x < viewport.width && box.y < viewport.height && box.x + box.width > 0 && box.y + box.height > 0;
      let crossOrigin = true;
      try { crossOrigin = new URL(frame.url()).origin !== pageOrigin; } catch { /* keep true */ }
      samples.push({ atMs, url: frame.url().split("?")[0]!.split("#")[0]!, width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0), visible, inViewport, inPlayer, crossOrigin });
    } catch {
      // A frame that navigates away while it is measured is sampled again next time.
    }
  }
}

async function scrollPlayerIntoView(page: Page, playerSelector: string): Promise<boolean> {
  for (const frame of [page.mainFrame(), ...page.frames().filter((item) => item !== page.mainFrame() && !item.isDetached())]) {
    const candidate = frame.locator(playerSelector).first();
    if (await candidate.count().catch(() => 0) === 0) continue;
    return candidate.evaluate((element) => { element.scrollIntoView({ block: "center", behavior: "instant" }); return true; }).catch(() => false);
  }
  return false;
}

async function scrollStep(page: Page, ratio: number): Promise<void> {
  await page.evaluate((value) => window.scrollBy({ top: Math.round(window.innerHeight * value), behavior: "instant" }), ratio);
}

export function createDeepBrowserRunner(dependencies: DeepBrowserRunnerDependencies = defaultDependencies) {
  return async function runDeepBrowser(options: DeepBrowserRunOptions): Promise<DeepBrowserRunResult> {
    validateOptions(options);
    const guard = new PublicEgressGuard(dependencies.resolve, options.allowPrivateNetwork ?? false);
    if (!await guard.allowed(options.targetUrl)) throw new TypeError("targetUrl must resolve to a public network address");
    const startedAt = new Date();
    const started = performance.now();
    const observations: BrowserObservation[] = [];
    const runErrors: BrowserRunError[] = [];
    const capture = new BrowserCapture({
      startedAt,
      elapsedMs: () => elapsed(started),
      serviceWorkersBlocked: true,
      // Real publisher pages issue far more requests than the fixture pages.
      limits: { maxEvidenceRecords: 10_000, settleTimeoutMs: 2_000, ...options.captureLimits },
    });
    let status: DeepBrowserRunResult["status"] = "runner_error";
    let browser: Browser | undefined;
    let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
    let page: Page | undefined;
    let browserVersion: string | null = null;
    let finalUrl: string | null = null;
    let contextClosed = false;
    let browserClosed = false;
    let captureResult: BrowserCaptureResult | undefined;
    let deadline: NodeJS.Timeout | undefined;
    let scriptOverrideHits = 0;
    let blockedRequestCount = 0;
    const screenshots: DeepScreenshot[] = [];
    const screenshotNotes: string[] = [];
    const safeFramesLoaded: Array<{ atMs: number; url: string }> = [];
    const safeFrameSamples: SafeFrameSample[] = [];
    let refreshWindow: { startMs: number; endMs: number } | null = null;
    const SAFE_FRAME_SAMPLE_MS = 5_000;

    try {
      browser = await dependencies.launch({
        executablePath: options.browserExecutablePath,
        headless: true,
        timeout: options.totalTimeoutMs,
        env: browserProcessEnvironment(),
        args: ["--autoplay-policy=no-user-gesture-required"],
      });
      browserVersion = browser.version();
      context = await browser.newContext({ ...options.contextOptions, serviceWorkers: "block" });
      await context.addInitScript(DOM_TRACKER_INIT_SCRIPT);
      if (options.injectCss !== undefined) await context.addInitScript(injectStyleScript(options.injectCss));
      await context.route("**/*", async (route) => {
        const url = route.request().url();
        if (!await guard.allowed(url)) {
          blockedRequestCount += 1;
          observations.push({ kind: "egress_blocked", atMs: elapsed(started), url, detail: "private or unresolvable network address" });
          await route.abort("blockedbyclient").catch(() => undefined);
          return;
        }
        if (options.scriptOverride !== undefined && isTagScript(url, options.scriptOverride.tagName, options.scriptOverride.loaderOrigin)) {
          scriptOverrideHits += 1;
          await route.fulfill({
            status: 200,
            contentType: "application/javascript; charset=utf-8",
            headers: { "access-control-allow-origin": "*", "cache-control": "no-store" },
            body: options.scriptOverride.body,
          }).catch(() => undefined);
          return;
        }
        await route.continue().catch(() => undefined);
      });
      await context.routeWebSocket("**/*", async (socket) => {
        if (await guard.allowed(socket.url())) {
          socket.connectToServer();
          return;
        }
        blockedRequestCount += 1;
        observations.push({ kind: "egress_blocked", atMs: elapsed(started), url: socket.url(), detail: "private or unresolvable network address" });
        await socket.close({ code: 1008, reason: "blocked by deep test egress policy" });
      });
      page = await context.newPage();
      page.on("console", (message) => observations.push({ kind: "console", atMs: elapsed(started), detail: `${message.type()}: ${message.text()}` }));
      page.on("pageerror", (error) => observations.push({ kind: "page_error", atMs: elapsed(started), detail: error.message }));
      if (options.safeFrames !== undefined) {
        page.on("framenavigated", (frame) => {
          if (isSafeFrameUrl(frame.url())) safeFramesLoaded.push({ atMs: elapsed(started), url: frame.url().split("?")[0]!.split("#")[0]! });
        });
      }
      capture.attach(page);

      const activePage = page;
      const flow = (async () => {
        await activePage.goto(options.targetUrl, { waitUntil: "domcontentloaded", timeout: options.navigationTimeoutMs });
        // Publisher pages often keep loading ads for a long time; observe once load fires or after a bounded wait.
        await activePage.waitForLoadState("load", { timeout: Math.min(15_000, options.navigationTimeoutMs) }).catch(() => undefined);
        await capture.captureVisibility(activePage, "after_load");
        await capture.captureDom(activePage);
        let observedMs = 0;
        let sinceScrollMs = 0;
        let scrollSteps = 0;
        let sinceFrameSampleMs = 0;
        const sampleFrames = async (stepMs: number) => {
          if (options.safeFrames === undefined) return;
          sinceFrameSampleMs += stepMs;
          if (sinceFrameSampleMs < SAFE_FRAME_SAMPLE_MS) return;
          sinceFrameSampleMs = 0;
          await sampleSafeFrames(activePage, options.safeFrames.playerSelector, elapsed(started), safeFrameSamples);
        };
        while (observedMs < options.observeAfterLoadMs) {
          const step = Math.min(options.visibilitySampleIntervalMs, options.observeAfterLoadMs - observedMs);
          await activePage.waitForTimeout(step);
          observedMs += step;
          sinceScrollMs += step;
          if (options.scroll !== undefined && scrollSteps < options.scroll.maxSteps && sinceScrollMs >= options.scroll.intervalMs) {
            sinceScrollMs = 0;
            scrollSteps += 1;
            await scrollStep(activePage, options.scroll.stepViewportRatio);
          }
          await capture.captureVisibility(activePage, "interval");
          await sampleFrames(step);
        }
        // Optional refresh watch: the slot normally refreshes only while the player is in view.
        if (options.refreshWatch !== undefined) {
          await scrollPlayerIntoView(activePage, options.refreshWatch.playerSelector);
          const startMs = elapsed(started);
          let watchedMs = 0;
          while (watchedMs < options.refreshWatch.watchMs) {
            const step = Math.min(1_000, options.refreshWatch.watchMs - watchedMs);
            await activePage.waitForTimeout(step);
            watchedMs += step;
            await capture.captureVisibility(activePage, "interval");
            await sampleFrames(step);
          }
          refreshWindow = { startMs, endMs: elapsed(started) };
        }
        if (options.safeFrames !== undefined) await sampleSafeFrames(activePage, options.safeFrames.playerSelector, elapsed(started), safeFrameSamples);
        await capture.capturePage(activePage);
        if (options.screenshots !== undefined) await capturePlayerScreenshots(activePage, options.screenshots, screenshots, screenshotNotes);
        await activePage.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
        finalUrl = activePage.url();
      })();
      void flow.catch(() => undefined);

      const remainingTotalMs = Math.max(0, options.totalTimeoutMs - elapsed(started));
      const outcome = await Promise.race([
        flow.then(() => ({ kind: "completed" as const }), (error: unknown) => ({ kind: "failed" as const, error })),
        new Promise<{ kind: "deadline" }>((resolveDeadline) => {
          deadline = setTimeout(() => resolveDeadline({ kind: "deadline" }), remainingTotalMs);
        }),
      ]);

      if (outcome.kind === "completed") {
        status = "completed";
      } else if (outcome.kind === "deadline") {
        status = "timed_out";
        runErrors.push(errorRecord("navigation", new Error(`total run deadline exceeded after ${options.totalTimeoutMs}ms`)));
      } else if (outcome.error instanceof errors.TimeoutError) {
        status = "timed_out";
        runErrors.push(errorRecord("navigation", outcome.error));
      } else if (isBrowserClosure(outcome.error) || !browser.isConnected()) {
        runErrors.push(errorRecord("browser", outcome.error));
      } else {
        runErrors.push(errorRecord("run", outcome.error));
      }
    } catch (error) {
      status = error instanceof errors.TimeoutError ? "timed_out" : "runner_error";
      const stage = browser === undefined ? "launch" : isBrowserClosure(error) || !browser.isConnected() ? "browser" : "run";
      runErrors.push(errorRecord(stage, error));
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
      if (page !== undefined && !page.isClosed()) {
        finalUrl = page.url() || finalUrl;
        // Closing the page first lets response-body reads that the page never consumed settle.
        await page.close().catch(() => undefined);
      }
      captureResult = await capture.finalize();
      if (context !== undefined) {
        try {
          await context.close();
          contextClosed = true;
        } catch (error) {
          contextClosed = browser !== undefined && !browser.isConnected();
          if (!contextClosed) runErrors.push(errorRecord("cleanup", error));
        }
      }
      if (browser !== undefined) {
        try {
          await browser.close();
          browserClosed = true;
        } catch (error) {
          browserClosed = !browser.isConnected();
          if (!browserClosed) runErrors.push(errorRecord("cleanup", error));
        }
      }
    }

    return {
      status,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: elapsed(started),
      metadata: {
        targetUrl: options.targetUrl,
        finalUrl,
        browser: "chromium",
        browserVersion,
        os: process.platform,
        viewport: options.contextOptions.viewport,
        coldCache: "new_context",
        networkConditions: "host_default_unshaped",
        egressBoundary: DEEP_EGRESS_BOUNDARY,
      },
      observations,
      capture: captureResult ?? await capture.finalize(),
      errors: runErrors,
      scriptOverrideHits,
      blockedRequestCount,
      screenshots,
      screenshotNotes,
      ...(options.safeFrames === undefined ? {} : { safeFrames: { loaded: safeFramesLoaded, samples: safeFrameSamples } }),
      refreshWindow,
      resourcesClosed: { context: contextClosed, browser: browserClosed },
    };
  };
}

export const runDeepBrowser = createDeepBrowserRunner();
