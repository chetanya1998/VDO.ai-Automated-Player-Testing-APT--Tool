import assert from "node:assert/strict";
import test from "node:test";
import { errors, type Browser, type BrowserContext, type Page } from "playwright-core";
import { createBrowserRunner, runBrowser, type BrowserRunOptions, type BrowserRunnerDependencies } from "../src/browser/run.js";
import { UrlPolicyError } from "../src/browser/url-policy.js";
import { startFixtureServer } from "./fixtures/server.js";

type Listener = (...args: unknown[]) => void;

interface FakeBrowserState {
  browserClosed: boolean;
  contextClosed: boolean;
}

function fakeBrowserDependencies(behavior: "healthy" | "new_page_error" | "crash" | "spa_transition" = "healthy"): {
  dependencies: BrowserRunnerDependencies;
  state: FakeBrowserState;
} {
  const state: FakeBrowserState = { browserClosed: false, contextClosed: false };
  const dependencies: BrowserRunnerDependencies = {
    launch: async () => {
      let connected = true;
      let routeHandler: ((route: {
        request(): { url(): string };
        continue(): Promise<void>;
        abort(): Promise<void>;
      }) => Promise<void>) | undefined;
      const listeners = new Map<string, Listener[]>();
      let currentUrl = "about:blank";

      const emit = (name: string, ...args: unknown[]) => {
        for (const listener of listeners.get(name) ?? []) listener(...args);
      };
      const requestResource = async (url: string, timeoutMs: number): Promise<string> => {
        const resourceType = url.endsWith(".js") ? "script" : "document";
        const request = {
          url: () => url,
          method: () => "GET",
          resourceType: () => resourceType,
          headers: () => ({}),
          postData: () => null,
          frame: () => ({ url: () => currentUrl }),
          redirectedFrom: () => null,
          failure: () => ({ errorText: "timed out" }),
        };
        emit("request", request);
        let allowed = false;
        await routeHandler?.({
          request: () => request,
          continue: async () => { allowed = true; },
          abort: async () => { allowed = false; },
        });
        if (!allowed) throw new Error(`request blocked: ${url}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(url, { signal: controller.signal });
          const text = await response.text();
          emit("response", {
            url: () => url,
            status: () => response.status,
            statusText: () => response.statusText,
            request: () => request,
            headers: () => Object.fromEntries(response.headers),
            finished: async () => null,
            body: async () => Buffer.from(text),
          });
          return text;
        } catch (error) {
          emit("requestfailed", request);
          if ((error as Error).name === "AbortError") throw new errors.TimeoutError(`navigation timeout after ${timeoutMs}ms`);
          throw error;
        } finally {
          clearTimeout(timeout);
        }
      };

      const page = {
        on(name: string, listener: Listener) {
          listeners.set(name, [...(listeners.get(name) ?? []), listener]);
          return page;
        },
        async goto(url: string, options: { timeout: number }) {
          currentUrl = url;
          if (behavior === "crash") {
            connected = false;
            throw new Error("Target page, context or browser has been closed");
          }
          const html = await requestResource(url, options.timeout);
          emit("framenavigated", { url: () => url });
          const source = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
          if (source) await requestResource(new URL(source, url).href, options.timeout);
          return null;
        },
        waitForTimeout(milliseconds: number) {
          return new Promise<void>((resolve) => setTimeout(() => {
            if (behavior === "spa_transition") {
              currentUrl = new URL("/articles/two", currentUrl).href;
              emit("framenavigated", { url: () => currentUrl });
            }
            resolve();
          }, milliseconds));
        },
        async evaluate(pageFunction: unknown) {
          if (String(pageFunction).includes("querySelectorAll")) return {
            anchors: [], externalScripts: [], bootstrapScripts: [], mutations: [], players: [],
          };
          const scenarioId = decodeURIComponent(new URL(currentUrl).pathname.split("/").at(-1) ?? "unknown");
          return {
            initial: { cookie: "", localStorageKeys: [] },
            final: { cookie: `fixture-run=${scenarioId}`, localStorageKeys: ["fixture-run"] },
          };
        },
        title: async () => "Synthetic fixture",
        frames: () => [{ name: () => "", url: () => currentUrl }],
        screenshot: async () => Buffer.from("fixture-image"),
        url: () => currentUrl,
      } as unknown as Page;

      const context = {
        addInitScript: async () => undefined,
        route: async (_pattern: string, handler: typeof routeHandler) => { routeHandler = handler; },
        newPage: async () => {
          if (behavior === "new_page_error") throw new Error("injected page creation failure");
          return page;
        },
        close: async () => { state.contextClosed = true; },
      } as unknown as BrowserContext;

      const browser = {
        version: () => "fixture-chromium-1",
        newContext: async () => context,
        isConnected: () => connected,
        close: async () => { connected = false; state.browserClosed = true; },
      } as unknown as Browser;
      return browser;
    },
  };
  return { dependencies, state };
}

function options(origin: string, targetUrl: string, overrides: Partial<BrowserRunOptions> = {}): BrowserRunOptions {
  return {
    targetUrl,
    approvedOrigins: [origin],
    browserExecutablePath: "fixture-chromium",
    viewport: { width: 1280, height: 720 },
    navigationTimeoutMs: 500,
    totalTimeoutMs: 1_500,
    observeAfterLoadMs: 10,
    ...overrides,
  };
}

test("bounded fixture browser execution", async (suite) => {
  const fixture = await startFixtureServer();
  suite.after(() => fixture.stop());

  await suite.test("rejects unsupported schemes and non-approved remote targets before launch", async () => {
    await assert.rejects(runBrowser(options(fixture.origin, "file:///etc/passwd")), UrlPolicyError);
    await assert.rejects(runBrowser(options(fixture.origin, "https://example.com/player")), /not approved for fixture execution/);
  });

  await suite.test("healthy and stalled fixture runs terminate with partial observations and closed resources", async () => {
    const runner = createBrowserRunner(fakeBrowserDependencies().dependencies);
    const healthy = await runner(options(fixture.origin, fixture.scenarioUrl("healthy-inline-video")));
    assert.equal(healthy.status, "completed");
    assert.equal(healthy.metadata.coldCache, "new_context");
    assert.deepEqual(healthy.metadata.viewport, { width: 1280, height: 720 });
    assert.equal(healthy.metadata.egressBoundary.unrestrictedRemoteExecution, false);
    assert.equal(healthy.metadata.coldCache, "new_context");
    assert.equal(healthy.metadata.networkConditions, "host_default_unshaped");
    assert.ok(healthy.observations.some((event) => event.kind === "request"));
    assert.ok(healthy.observations.some((event) => event.kind === "response"));
    assert.ok(healthy.capture.evidence.some((item) => item.source === "browser_network"));
    assert.ok(healthy.capture.evidence.some((item) => item.source === "browser_dom"));
    assert.ok(healthy.capture.gaps.some((gap) => gap.code === "service_worker_visibility"));
    assert.deepEqual(healthy.resourcesClosed, { context: true, browser: true });

    const stalled = await runner(options(fixture.origin, fixture.scenarioUrl("stalled-response"), {
      navigationTimeoutMs: 100,
      totalTimeoutMs: 500,
      observeAfterLoadMs: 0,
    }));
    assert.equal(stalled.status, "timed_out");
    assert.ok(stalled.durationMs < 1_000, `stalled run took ${stalled.durationMs}ms`);
    assert.ok(stalled.observations.some((event) => event.kind === "request_failed"));
    assert.deepEqual(stalled.resourcesClosed, { context: true, browser: true });
  });

  await suite.test("consecutive runs start without cookies or local storage", async () => {
    const runner = createBrowserRunner(fakeBrowserDependencies().dependencies);
    const first = await runner(options(fixture.origin, fixture.scenarioUrl("healthy-inline-video")));
    const second = await runner(options(fixture.origin, fixture.scenarioUrl("healthy-inline-video")));
    assert.deepEqual(first.initialStorage, { cookie: "", localStorageKeys: [] });
    assert.deepEqual(second.initialStorage, { cookie: "", localStorageKeys: [] });
    assert.match(first.finalStorage?.cookie ?? "", /fixture-run=healthy-inline-video/);
    assert.deepEqual(first.finalStorage?.localStorageKeys, ["fixture-run"]);
  });

  await suite.test("capture remains active through an approved same-document transition", async () => {
    const result = await createBrowserRunner(fakeBrowserDependencies("spa_transition").dependencies)(
      options(fixture.origin, fixture.scenarioUrl("spa-three-articles")),
    );
    const navigations = result.observations.filter((event) => event.kind === "navigation");
    assert.equal(result.status, "completed");
    assert.ok(navigations.some((event) => event.url === `${fixture.origin}/articles/two`));
  });

  await suite.test("an internal exception still closes its context and browser", async () => {
    const harness = fakeBrowserDependencies("new_page_error");
    const result = await createBrowserRunner(harness.dependencies)(options(fixture.origin, fixture.scenarioUrl("healthy-inline-video")));
    assert.equal(result.status, "runner_error");
    assert.match(result.errors[0]?.message ?? "", /injected page creation failure/);
    assert.deepEqual(result.resourcesClosed, { context: true, browser: true });
    assert.deepEqual(harness.state, { contextClosed: true, browserClosed: true });
  });

  await suite.test("a browser crash is classified as a runner error", async () => {
    const result = await createBrowserRunner(fakeBrowserDependencies("crash").dependencies)(
      options(fixture.origin, fixture.scenarioUrl("stalled-response")),
    );
    assert.equal(result.status, "runner_error");
    assert.equal(result.errors[0]?.stage, "browser");
    assert.deepEqual(result.resourcesClosed, { context: true, browser: true });
  });

  await suite.test("live Chromium smoke test", { skip: process.env.VDO_VALIDATOR_BROWSER ? false : "set VDO_VALIDATOR_BROWSER outside the managed sandbox" }, async () => {
    const result = await runBrowser(options(fixture.origin, fixture.scenarioUrl("healthy-inline-video"), {
      browserExecutablePath: process.env.VDO_VALIDATOR_BROWSER!,
    }));
    assert.equal(result.status, "completed", JSON.stringify(result.errors));
  });
});

