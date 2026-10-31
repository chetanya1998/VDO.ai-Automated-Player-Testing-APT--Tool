import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { runDeepValidation, type DeepBrowserRunResult, type DeepValidationInput } from "../src/deep/index.js";
import { DEEP_EGRESS_BOUNDARY } from "../src/deep/runner.js";
import type { Evidence } from "../src/contracts.js";
import { startFixtureServer } from "./fixtures/server.js";

const desktop: DeepValidationInput["device"] = { id: "desktop", kind: "desktop", contextOptions: { viewport: { width: 1366, height: 768 } } };

function emptyRun(status: DeepBrowserRunResult["status"]): DeepBrowserRunResult {
  const now = new Date().toISOString();
  return {
    status,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    metadata: {
      targetUrl: "https://publisher.example/article",
      finalUrl: null,
      browser: "chromium",
      browserVersion: null,
      os: process.platform,
      viewport: desktop.contextOptions.viewport,
      coldCache: "new_context",
      networkConditions: "host_default_unshaped",
      egressBoundary: DEEP_EGRESS_BOUNDARY,
    },
    observations: [],
    capture: { evidence: [], gaps: [], complete: true },
    errors: status === "runner_error" ? [{ stage: "launch", name: "Error", message: "browser missing" }] : [],
    scriptOverrideHits: 0,
    screenshots: [],
    screenshotNotes: [],
    blockedRequestCount: 0,
    resourcesClosed: { context: true, browser: true },
  };
}

test("deep validation reports all 23 cases with titles, draft-policy limits and no invented passes", async () => {
  const { summary, report } = await runDeepValidation({
    targetUrl: "https://publisher.example/article",
    domain: "publisher.example",
    tagName: "v-publisher-example",
    device: desktop,
    browserExecutablePath: "unused",
    code: { type: "vdo.ai.js", body: "/* custom */" },
    runBrowser: async () => emptyRun("completed"),
  });

  assert.equal(report.checks.length, 23);
  assert.deepEqual(summary.cases.map((item) => item.testCaseId), Array.from({ length: 23 }, (_, index) => `TC-${index + 1}`));
  assert.ok(summary.cases.every((item) => item.title.length > 0 && item.summary.length > 0));
  assert.ok(summary.cases.every((item) => item.checks.length > 20 && item.meaning.length > 10), "every case explains what it checks and what its result means");
  assert.match(summary.cases.find((item) => item.testCaseId === "TC-5")?.summary ?? "", /'loaded' event never fired/);
  assert.equal(summary.policyStatus, "draft");
  assert.equal(summary.scriptOverrideHits, 0);
  assert.ok(summary.limitations.some((item) => item.includes("custom placement code did not run")));
  assert.equal(summary.cases.find((item) => item.testCaseId === "TC-4")?.verdict === "PASS", false, "no logger evidence cannot pass TC-4");
  for (const id of ["TC-19", "TC-20"]) assert.equal(summary.cases.find((item) => item.testCaseId === id)?.verdict, "UNKNOWN");
});

test("deep validation marks every case unverified when the browser fails", async () => {
  const { summary } = await runDeepValidation({
    targetUrl: "https://publisher.example/article",
    domain: "publisher.example",
    tagName: "v-publisher-example",
    device: desktop,
    browserExecutablePath: "unused",
    runBrowser: async () => emptyRun("runner_error"),
  });
  assert.equal(summary.verdictCounts.UNKNOWN, 23);
  assert.equal(summary.executionErrors[0]?.message, "browser missing");
});

test("an unapproved tag prefix fails TC-18", async () => {
  const withLogger = emptyRun("completed");
  withLogger.capture.evidence.push({
    evidenceId: "browser-000001",
    source: "browser_logger",
    capturedAt: withLogger.startedAt,
    data: {
      kind: "logger_request",
      networkEvidenceId: null,
      url: "https://analytics.vdo.ai/logger",
      requestStartPageUrl: "https://publisher.example/article",
      parseState: "allowlisted",
      fields: { event: "loaded", tagName: "x-publisher-example", domainName: "publisher.example", page_url: "https://publisher.example/article", dep: "d1" },
    },
  });
  const { summary } = await runDeepValidation({
    targetUrl: "https://publisher.example/article",
    domain: "publisher.example",
    tagName: "x-publisher-example",
    device: desktop,
    browserExecutablePath: "unused",
    runBrowser: async () => withLogger,
  });
  assert.equal(summary.cases.find((item) => item.testCaseId === "TC-18")?.verdict, "FAIL");
});

test("live deep validation against local fixture pages", { skip: process.env.VDO_VALIDATOR_BROWSER ? false : "set VDO_VALIDATOR_BROWSER outside the managed sandbox" }, async (suite) => {
  const server = await startFixtureServer();
  const tagName = "v-example-site";
  const common = {
    domain: "publisher.example",
    tagName,
    device: desktop,
    browserExecutablePath: process.env.VDO_VALIDATOR_BROWSER!,
    loaderUrl: `${server.origin}/core/${tagName}/vdo.ai.js`,
    allowPrivateNetwork: true,
    observeAfterLoadMs: 1_500,
    totalTimeoutMs: 30_000,
  };
  try {
    await suite.test("healthy page evaluates logger, tag and build cases from captured evidence", async () => {
      const { summary } = await runDeepValidation({ ...common, targetUrl: server.scenarioUrl("healthy-inline-video") });
      const verdict = (id: string) => summary.cases.find((item) => item.testCaseId === id)?.verdict;
      assert.equal(summary.executionState, "completed");
      assert.equal(summary.cases.length, 23);
      assert.equal(verdict("TC-1"), "PASS");
      assert.equal(verdict("TC-3"), "PASS");
      assert.equal(verdict("TC-4"), "PASS");
      assert.equal(verdict("TC-18"), "PASS");
      assert.equal(verdict("TC-19"), "PASS");
      assert.equal(verdict("TC-20"), "PASS");
      assert.equal(verdict("TC-23"), "UNKNOWN");
    });

    await suite.test("duplicate implementation fails TC-3", async () => {
      const { summary } = await runDeepValidation({ ...common, targetUrl: server.scenarioUrl("duplicate-implementation") });
      assert.equal(summary.cases.find((item) => item.testCaseId === "TC-3")?.verdict, "FAIL");
    });

    await suite.test("custom vdo.ai.js replaces the tag script for the deep run", async () => {
      const { summary } = await runDeepValidation({
        ...common,
        targetUrl: server.scenarioUrl("healthy-inline-video"),
        code: { type: "vdo.ai.js", body: "window.__deepOverride = true;" },
      });
      assert.ok((summary.scriptOverrideHits ?? 0) >= 1);
      assert.notEqual(summary.cases.find((item) => item.testCaseId === "TC-4")?.verdict, "PASS", "the replaced script sends no logger events");
    });
  } finally {
    await server.stop();
  }
});

// A page installed with the documented snippet whose vdo.ai.js behaves like the live tag: it moves the
// publisher's div after .entry-header (custom placement) and renames it to <tag>-0 when the player forms.
const REAL_TAG = "v-mock-site";
const REAL_PAGE = `<!doctype html><html><head><title>Article</title></head><body>
<header><nav>Site header</nav></header>
<main><h1 class="entry-header">Article title</h1><p>Intro paragraph.</p><div id="${REAL_TAG}"></div><p>More text.</p></main>
<script>(function(v, d, o, ai) { ai = d.createElement('script'); ai.defer = true; ai.async = true; ai.src = v.location.protocol + o; d.head.appendChild(ai); })(window, document, '//' + location.host + '/core/${REAL_TAG}/vdo.ai.js');</script>
<footer>Site footer</footer></body></html>`;
const REAL_LOADER = `(async () => {
  const send = (event) => fetch('/logger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event, tagName: '${REAL_TAG}', domainName: 'publisher.example', page_url: location.href, dep: 'dependencies_hbv4_latest' }) });
  await send('loaded');
  const div = document.getElementById('${REAL_TAG}');
  document.querySelector('.entry-header').insertAdjacentElement('afterend', div);
  div.id = '${REAL_TAG}-0';
  div.style.cssText = 'display:block;width:640px;height:360px;background:#123';
  await send('initVdo');
  await send('Pageview');
})();`;

test("live deep validation of a page whose tag moves and renames its div", { skip: process.env.VDO_VALIDATOR_BROWSER ? false : "set VDO_VALIDATOR_BROWSER outside the managed sandbox" }, async () => {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/article") { response.writeHead(200, { "content-type": "text/html" }); response.end(REAL_PAGE); return; }
    if (path === `/core/${REAL_TAG}/vdo.ai.js`) { response.writeHead(200, { "content-type": "application/javascript" }); response.end(REAL_LOADER); return; }
    if (path === "/logger") { request.resume(); response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); return; }
    response.writeHead(404); response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
  try {
    const { summary } = await runDeepValidation({
      targetUrl: `${origin}/article`,
      domain: "publisher.example",
      tagName: REAL_TAG,
      device: desktop,
      browserExecutablePath: process.env.VDO_VALIDATOR_BROWSER!,
      loaderUrl: `${origin}/core/${REAL_TAG}/vdo.ai.js`,
      allowPrivateNetwork: true,
      observeAfterLoadMs: 1_500,
      totalTimeoutMs: 30_000,
    });
    const item = (id: string) => summary.cases.find((entry) => entry.testCaseId === id);
    assert.equal(item("TC-1")?.verdict, "PASS", item("TC-1")?.summary);
    assert.equal(item("TC-3")?.verdict, "PASS", item("TC-3")?.summary);
    assert.equal(item("TC-13")?.verdict, "PASS", item("TC-13")?.summary);
    assert.equal(item("TC-4")?.verdict, "PASS", item("TC-4")?.summary);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("TC-2 times every player file: 500 ms passes, up to 1000 ms warns, slower or unfinished fails", async () => {
  const { validatePlayerFileTiming } = await import("../src/deep/cases.js");
  const request = (id: number, path: string, durationMs: number | null, outcome = "http_success"): Evidence => ({
    schemaVersion: 1,
    runId: "run-1",
    articleEpochId: "a1",
    deviceId: "desktop",
    evidenceId: `browser-${id}`,
    source: "browser_network",
    capturedAt: new Date().toISOString(),
    data: { kind: "request", url: `https://a.vdo.ai${path}`, durationMs, outcome },
  });
  const check = (...evidence: Evidence[]) => validatePlayerFileTiming({
    evidence, product: "video", deviceId: "desktop", articleEpochId: "a1", tagName: "v-site", passMaxMs: 500, warningMaxMs: 1000,
    dependencies: [{ id: "vdo.min.js", products: ["video"], pathSuffixes: ["/vdo.min.js"] }],
  });
  assert.equal(check(request(1, "/core/v-site/vdo.ai.js", 120), request(2, "/core/vdo.min.js", 480)).verdict, "PASS");
  const warning = check(request(1, "/core/v-site/vdo.ai.js", 516), request(2, "/other.js", 5000));
  assert.equal(warning.verdict, "WARNING", "files that are not player files are ignored");
  const failures = (result: ReturnType<typeof check>) => (result.observed as { failures: string[] }).failures;
  assert.deepEqual(failures(warning), ["vdo.ai.js took 516 ms (over 500 ms)"]);
  assert.equal(check(request(1, "/core/v-site/vdo.ai.js", 200), request(2, "/core/vdo.min.js", 1200)).verdict, "FAIL");
  assert.deepEqual(failures(check(request(1, "/core/v-site/vdo.ai.js", null, "incomplete"))), ["vdo.ai.js never finished loading"]);
  assert.equal(check().verdict, "UNKNOWN");
});

test("mobile deep tests do not require iPhone/Safari evidence", async () => {
  const mobile: DeepValidationInput["device"] = { id: "mobile", kind: "mobile", contextOptions: { viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true } };
  const { report } = await runDeepValidation({
    targetUrl: "https://publisher.example/article",
    domain: "publisher.example",
    tagName: "v-publisher-example",
    device: mobile,
    browserExecutablePath: "unused",
    runBrowser: async () => emptyRun("completed"),
  });
  const tc16 = report.checks.find((check) => check.testCaseId === "TC-16");
  const observed = tc16?.observed as { coverageGaps: string[]; failures: string[]; missingExercises: string[] };
  assert.equal((tc16?.expected as { realIosEvidence: string }).realIosEvidence, "not_applicable");
  assert.doesNotMatch(JSON.stringify([observed.coverageGaps, observed.failures, observed.missingExercises]), /iOS|Safari|blocked_inline/i);
});
