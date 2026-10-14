import { chromium, errors, type Browser, type LaunchOptions, type Page } from "playwright-core";
import { BrowserCapture, type BrowserCaptureResult, type CaptureLimits } from "./capture.js";
import { DOM_TRACKER_INIT_SCRIPT } from "./dom.js";
import {
  PRODUCTION_EGRESS_BOUNDARY,
  UrlPolicyError,
  assertApprovedUrl,
  createFixtureUrlPolicy,
  type FixtureUrlPolicy,
} from "./url-policy.js";

export interface BrowserRunOptions {
  targetUrl: string;
  approvedOrigins: readonly string[];
  browserExecutablePath: string;
  viewport: { width: number; height: number };
  navigationTimeoutMs: number;
  totalTimeoutMs: number;
  observeAfterLoadMs?: number;
  captureLimits?: Partial<CaptureLimits>;
}

export interface BrowserObservation {
  kind: "request" | "response" | "request_failed" | "navigation" | "console" | "page_error" | "egress_blocked";
  atMs: number;
  url?: string;
  status?: number;
  detail?: string;
}

export interface BrowserRunError {
  stage: "launch" | "navigation" | "browser" | "run" | "cleanup";
  name: string;
  message: string;
}

export interface StorageSnapshot {
  cookie: string;
  localStorageKeys: string[];
}

export interface BrowserRunResult {
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
    egressBoundary: typeof PRODUCTION_EGRESS_BOUNDARY;
  };
  initialStorage: StorageSnapshot | null;
  finalStorage: StorageSnapshot | null;
  observations: BrowserObservation[];
  capture: BrowserCaptureResult;
  errors: BrowserRunError[];
  resourcesClosed: { context: boolean; browser: boolean };
}

export interface BrowserRunnerDependencies {
  launch(options: LaunchOptions): Promise<Browser>;
}

const defaultDependencies: BrowserRunnerDependencies = {
  launch: (options) => chromium.launch(options),
};

function validateOptions(options: BrowserRunOptions): void {
  for (const [name, value] of [
    ["viewport.width", options.viewport.width],
    ["viewport.height", options.viewport.height],
    ["navigationTimeoutMs", options.navigationTimeoutMs],
    ["totalTimeoutMs", options.totalTimeoutMs],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  }
  if (options.observeAfterLoadMs !== undefined && (!Number.isInteger(options.observeAfterLoadMs) || options.observeAfterLoadMs < 0)) {
    throw new TypeError("observeAfterLoadMs must be a non-negative integer");
  }
  if (options.browserExecutablePath.trim() === "") throw new TypeError("browserExecutablePath is required");
}

function errorRecord(stage: BrowserRunError["stage"], value: unknown): BrowserRunError {
  const error = value instanceof Error ? value : new Error(String(value));
  return { stage, name: error.name, message: error.message };
}

function isBrowserClosure(value: unknown): boolean {
  const message = value instanceof Error ? value.message : String(value);
  return /browser.*closed|target page.*closed|context.*closed|has been closed|browser has disconnected/i.test(message);
}

function elapsed(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}

function registerListeners(page: Page, observations: BrowserObservation[], started: number): void {
  page.on("request", (request) => observations.push({ kind: "request", atMs: elapsed(started), url: request.url() }));
  page.on("response", (response) => observations.push({ kind: "response", atMs: elapsed(started), url: response.url(), status: response.status() }));
  page.on("requestfailed", (request) => observations.push({
    kind: "request_failed",
    atMs: elapsed(started),
    url: request.url(),
    detail: request.failure()?.errorText ?? "request failed",
  }));
  page.on("framenavigated", (frame) => observations.push({ kind: "navigation", atMs: elapsed(started), url: frame.url() }));
  page.on("console", (message) => observations.push({ kind: "console", atMs: elapsed(started), detail: `${message.type()}: ${message.text()}` }));
  page.on("pageerror", (error) => observations.push({ kind: "page_error", atMs: elapsed(started), detail: error.message }));
}

async function readStorage(page: Page): Promise<{ initial: StorageSnapshot; final: StorageSnapshot }> {
  return page.evaluate(() => {
    const globalWithSnapshot = globalThis as typeof globalThis & { __vdoInitialStorage?: StorageSnapshot };
    const empty: StorageSnapshot = { cookie: "", localStorageKeys: [] };
    return {
      initial: globalWithSnapshot.__vdoInitialStorage ?? empty,
      final: { cookie: document.cookie, localStorageKeys: Object.keys(localStorage).sort() },
    };
  });
}

export function createBrowserRunner(dependencies: BrowserRunnerDependencies = defaultDependencies) {
  return async function runBrowser(options: BrowserRunOptions): Promise<BrowserRunResult> {
    validateOptions(options);
    const policy = createFixtureUrlPolicy(options.approvedOrigins);
    const target = assertApprovedUrl(options.targetUrl, policy);
    const startedAt = new Date();
    const started = performance.now();
    const observations: BrowserObservation[] = [];
    const runErrors: BrowserRunError[] = [];
    const capture = new BrowserCapture({
      startedAt,
      elapsedMs: () => elapsed(started),
      ...(options.captureLimits === undefined ? {} : { limits: options.captureLimits }),
    });
    const blockedUrls: string[] = [];
    let status: BrowserRunResult["status"] = "runner_error";
    let browser: Browser | undefined;
    let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
    let page: Page | undefined;
    let browserVersion: string | null = null;
    let finalUrl: string | null = null;
    let initialStorage: StorageSnapshot | null = null;
    let finalStorage: StorageSnapshot | null = null;
    let contextClosed = false;
    let browserClosed = false;
    let captureResult: BrowserCaptureResult | undefined;
    let deadline: NodeJS.Timeout | undefined;

    try {
      browser = await dependencies.launch({
        executablePath: options.browserExecutablePath,
        headless: true,
        timeout: options.totalTimeoutMs,
      });
      browserVersion = browser.version();
      context = await browser.newContext({ viewport: options.viewport });
      await context.addInitScript(`globalThis.__vdoInitialStorage={cookie:document.cookie,localStorageKeys:Object.keys(localStorage).sort()}`);
      await context.addInitScript(DOM_TRACKER_INIT_SCRIPT);
      await context.route("**/*", async (route) => {
        try {
          assertApprovedUrl(route.request().url(), policy);
          await route.continue();
        } catch (error) {
          const url = route.request().url();
          blockedUrls.push(url);
          observations.push({ kind: "egress_blocked", atMs: elapsed(started), url, detail: error instanceof Error ? error.message : String(error) });
          await route.abort("blockedbyclient");
        }
      });
      page = await context.newPage();
      registerListeners(page, observations, started);
      capture.attach(page);

      const flow = (async () => {
        await page.goto(target.href, { waitUntil: "load", timeout: options.navigationTimeoutMs });
        if ((options.observeAfterLoadMs ?? 0) > 0) await page.waitForTimeout(options.observeAfterLoadMs ?? 0);
        await capture.capturePage(page);
        if (blockedUrls.length > 0) throw new UrlPolicyError(`blocked ${blockedUrls.length} request(s) outside the fixture origin`);
        const storage = await readStorage(page);
        initialStorage = storage.initial;
        finalStorage = storage.final;
        finalUrl = page.url();
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
        status = "runner_error";
        runErrors.push(errorRecord("browser", outcome.error));
      } else {
        status = "runner_error";
        runErrors.push(errorRecord("run", outcome.error));
      }
    } catch (error) {
      status = "runner_error";
      const stage = browser === undefined ? "launch" : isBrowserClosure(error) || !browser.isConnected() ? "browser" : "run";
      if (error instanceof errors.TimeoutError) status = "timed_out";
      runErrors.push(errorRecord(stage, error));
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
      if (page !== undefined) finalUrl = page.url() || finalUrl;
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

    const endedAt = new Date();
    return {
      status,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: elapsed(started),
      metadata: {
        targetUrl: target.href,
        finalUrl,
        browser: "chromium",
        browserVersion,
        os: process.platform,
        viewport: options.viewport,
        coldCache: "new_context",
        networkConditions: "host_default_unshaped",
        egressBoundary: PRODUCTION_EGRESS_BOUNDARY,
      },
      initialStorage,
      finalStorage,
      observations,
      capture: captureResult ?? await capture.finalize(),
      errors: runErrors,
      resourcesClosed: { context: contextClosed, browser: browserClosed },
    };
  };
}

export const runBrowser = createBrowserRunner();

