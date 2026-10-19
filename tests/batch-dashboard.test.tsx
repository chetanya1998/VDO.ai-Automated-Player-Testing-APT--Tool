import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BatchForm } from "../web/src/BatchForm.js";
import { BatchStatus } from "../web/src/BatchStatus.js";
import type { BatchDetail } from "../web/src/types.js";

test("batch dashboard renders bounded input, mixed item states, and device completeness", () => {
  const batch: BatchDetail = {
    batchId: "batch-ui",
    createdAt: "2026-10-19T12:00:00.000Z",
    status: "completed_with_issues",
    counts: { total: 3, accepted: 2, rejected: 1, terminal: 2 },
    completeness: {
      devices: [{ deviceId: "desktop", acceptedRuns: 2, terminalRuns: 2, reportedCaseIds: ["TC-1"] }],
      cases: Array.from({ length: 23 }, (_, index) => ({
        testCaseId: `TC-${index + 1}`,
        reportedRuns: index === 0 ? 2 : 0,
        expectedRuns: 2,
      })),
    },
    items: [
      { itemIndex: 0, targetUrl: "http://127.0.0.1/one", deviceId: "desktop", admissionState: "accepted", state: "completed", runId: "run-one", deadlineAt: "2026-10-19T12:05:00.000Z", reportAvailable: true, reportedCaseIds: ["TC-1"], error: null, runUrl: "/v1/runs/run-one", reportUrl: "/v1/runs/run-one/report" },
      { itemIndex: 1, targetUrl: "http://127.0.0.1/two", deviceId: "desktop", admissionState: "accepted", state: "errored", runId: "run-two", deadlineAt: "2026-10-19T12:05:00.000Z", reportAvailable: false, reportedCaseIds: [], error: null, runUrl: "/v1/runs/run-two", reportUrl: "/v1/runs/run-two/report" },
      { itemIndex: 2, targetUrl: "https://not-approved.example", deviceId: "desktop", admissionState: "rejected", state: "rejected", runId: null, deadlineAt: null, reportAvailable: false, reportedCaseIds: [], error: { code: "target_not_approved", message: "target URL is not approved" }, runUrl: null, reportUrl: null },
    ],
  };
  const form = renderToStaticMarkup(<BatchForm busy={false} onSubmit={async () => undefined} />);
  const status = renderToStaticMarkup(<BatchStatus batch={batch} onOpenRun={() => undefined} onRefresh={() => undefined} />);
  assert.match(form, /Validate a bounded list/);
  assert.match(form, /Target URLs, one per line/);
  assert.match(form, /separate run with its own deadline/);
  assert.match(status, /completed with issues/);
  assert.match(status, /target_not_approved/);
  assert.match(status, /2\/2 terminal, 1\/23 cases reported/);
  assert.equal((status.match(/>Inspect run<\/button>/g) ?? []).length, 2);
  assert.match(status, /five-minute deadline applies separately/);
});
