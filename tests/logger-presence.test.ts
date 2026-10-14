import assert from "node:assert/strict";
import test from "node:test";
import { parseEvidence, type Evidence, type JsonValue } from "../src/contracts.js";
import { validateLoggerPresence } from "../src/rules/logger-presence.js";

const loaderUrl = "https://a.vdo.ai/core/v-approved/vdo.ai.js";

function evidence(evidenceId: string, source: Evidence["source"], data: { [key: string]: JsonValue }): Evidence {
  return parseEvidence({
    schemaVersion: 1,
    evidenceId,
    runId: "run-recorded",
    articleEpochId: "article-recorded",
    deviceId: "desktop-chromium",
    source,
    capturedAt: "2026-10-14T00:00:00.000Z",
    data,
  });
}

function request(evidenceId: string, url: string, status: number, outcome: string): Evidence {
  return evidence(evidenceId, "browser_network", { kind: "request", url, status, outcome });
}

function validate(items: Evidence[], captureComplete = true) {
  return validateLoggerPresence({
    evidence: items,
    deviceId: "desktop-chromium",
    articleEpochId: "article-recorded",
    tagName: "v-approved",
    loaderUrl,
    captureComplete,
  });
}

test("TC-4 distinguishes successful, failed, absent, and incomplete browser evidence", () => {
  const loader = request("loader", loaderUrl, 200, "http_success");
  const logger200 = request("logger-network", "https://l.vdo.ai/logger.php", 200, "http_success");
  const logger500 = request("logger-failed", "https://l.vdo.ai/logger.php", 500, "http_failure");
  const logger = (networkEvidenceId: string) => evidence(`logger-${networkEvidenceId}`, "browser_logger", {
    kind: "logger_request",
    networkEvidenceId,
    url: "https://l.vdo.ai/logger.php",
  });

  assert.equal(validate([loader, logger200, logger("logger-network")]).verdict, "PASS");
  const failed = validate([loader, logger500, logger("logger-failed")]);
  assert.equal(failed.verdict, "FAIL");
  assert.deepEqual(failed.evidenceIds, ["logger-logger-failed", "logger-failed"]);
  assert.equal(validate([loader]).verdict, "FAIL");
  assert.equal(validate([loader], false).verdict, "UNKNOWN");
  assert.equal(validate([loader, logger("missing-network")]).verdict, "UNKNOWN");
});

test("TC-4 does not blame logger absence before successful loader execution", () => {
  assert.equal(validate([request("loader-failed", loaderUrl, 503, "http_failure")]).verdict, "UNKNOWN");
});
