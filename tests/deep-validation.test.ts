import assert from "node:assert/strict";
import test from "node:test";
import { runDeepValidation, type DeepBrowserRunResult, type DeepValidationInput } from "../src/deep/index.js";
import { DEEP_EGRESS_BOUNDARY } from "../src/deep/runner.js";
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
