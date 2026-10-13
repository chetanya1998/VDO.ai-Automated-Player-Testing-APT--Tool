import assert from "node:assert/strict";
import test from "node:test";
import { parseEvidence, type Evidence, type JsonValue } from "../src/contracts.js";
import { validateIntegration, type IntegrationExpectation } from "../src/rules/integration.js";
import type { SiteTagProfile } from "../src/profile/tag-identity.js";

const createdAt = "2026-10-13T00:00:00.000Z";
const inlineTag: SiteTagProfile = {
  baseTag: "v-example-site",
  allowedTagNames: ["v-example-site", "v-example-site-v1", "v-example-site-v2"],
  product: "video",
  placement: "inline_body_content",
  floatingMode: "inline",
  ruleSupport: "supported",
};

function expectation(tagName = "v-example-site", overrides: Partial<IntegrationExpectation> = {}): IntegrationExpectation {
  return {
    tag: { ...inlineTag, baseTag: tagName, allowedTagNames: [tagName] },
    tagName,
    loaderUrl: `https://a.vdo.ai/core/${tagName}/vdo.ai.js`,
    expectedRequestCount: 1,
    expectedExternalScriptCount: 1,
    expectedBootstrapScriptCount: 0,
    expectedAnchorCount: 1,
    expectedScriptType: "classic",
    ...overrides,
  };
}

function evidence(evidenceId: string, source: Evidence["source"], data: { [key: string]: JsonValue }, milliseconds = 0): Evidence {
  return parseEvidence({
    schemaVersion: 1,
    evidenceId,
    runId: "run-integration",
    articleEpochId: "article-one",
    deviceId: "desktop-chromium",
    source,
    capturedAt: new Date(Date.parse(createdAt) + milliseconds).toISOString(),
    data,
  });
}

function loader(tagName: string, id = `network-${tagName}`, outcome = "http_success", status: number | null = 200): Evidence {
  return evidence(id, "browser_network", {
    kind: "request",
    url: `https://a.vdo.ai/core/${tagName}/vdo.ai.js?cache=fixture`,
    resourceType: "script",
    status,
    outcome,
    initiator: { resourceType: "script", frameUrl: "https://publisher.example/articles/one" },
  });
}

function dom(options: {
  anchors?: JsonValue[];
  scripts?: JsonValue[];
  bootstrap?: JsonValue[];
  mutations?: JsonValue[];
} = {}): Evidence {
  return evidence("dom-snapshot", "browser_dom", {
    kind: "page_snapshot",
    pageUrl: "https://publisher.example/articles/one",
    anchors: options.anchors ?? [{ id: "v-example-site", tag: "div", parentLandmark: "main", placement: "body_content" }],
    externalScripts: options.scripts ?? [{ src: "https://a.vdo.ai/core/v-example-site/vdo.ai.js", tagNameFromUrl: "v-example-site", scriptType: "classic", parentLandmark: "body" }],
    bootstrapScripts: options.bootstrap ?? [],
    mutations: options.mutations ?? [{ kind: "anchor", identity: "v-example-site", tagName: "v-example-site", added: 1, removed: 0 }],
    players: [],
  }, 50);
}

function verdicts(items: ReturnType<typeof validateIntegration>): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.testCaseId, item.verdict]));
}

test("healthy inline and floating integrations pass", () => {
  const inline = validateIntegration({ evidence: [loader("v-example-site"), dom()], expectation: expectation(), deviceId: "desktop-chromium", articleEpochId: "article-one" });
  assert.deepEqual(verdicts(inline), { "TC-1": "PASS", "TC-3": "PASS", "TC-13": "PASS" });
  assert.deepEqual(inline.map((item) => item.testCaseId), ["TC-1", "TC-3", "TC-13"]);

  const floatingExpectation = expectation("v-floating", {
    tag: { ...inlineTag, baseTag: "v-floating", allowedTagNames: ["v-floating"], placement: "floating", floatingMode: "floating" },
    expectedAnchorCount: 0,
  });
  const floatingDom = dom({
    anchors: [],
    scripts: [{ src: "https://a.vdo.ai/core/v-floating/vdo.ai.js", tagNameFromUrl: "v-floating", scriptType: "classic", parentLandmark: "body" }],
    mutations: [{ kind: "external_script", identity: "https://a.vdo.ai/core/v-floating/vdo.ai.js", tagName: "v-floating", added: 1, removed: 0 }],
  });
  const floating = validateIntegration({ evidence: [loader("v-floating"), floatingDom], expectation: floatingExpectation, deviceId: "desktop-chromium", articleEpochId: "article-one" });
  assert.deepEqual(verdicts(floating), { "TC-1": "PASS", "TC-3": "PASS", "TC-13": "PASS" });
});

test("wrong or missing tags and anchors fail with evidence", () => {
  const wrongDom = dom({
    anchors: [{ id: "v-wrong", tag: "div", parentLandmark: "main", placement: "body_content" }],
    scripts: [{ src: "https://a.vdo.ai/core/v-wrong/vdo.ai.js", tagNameFromUrl: "v-wrong", scriptType: "classic", parentLandmark: "body" }],
  });
  const wrong = validateIntegration({ evidence: [loader("v-wrong"), wrongDom], expectation: expectation(), deviceId: "desktop-chromium", articleEpochId: "article-one" });
  assert.deepEqual(verdicts(wrong), { "TC-1": "FAIL", "TC-3": "FAIL", "TC-13": "FAIL" });
  assert.ok(wrong.every((item) => item.evidenceIds.length > 0));

  const missing = validateIntegration({ evidence: [dom({ anchors: [], scripts: [], mutations: [] })], expectation: expectation(), deviceId: "desktop-chromium", articleEpochId: "article-one" });
  assert.deepEqual(verdicts(missing), { "TC-1": "FAIL", "TC-3": "FAIL", "TC-13": "FAIL" });
});

test("duplicate requests, anchors, scripts, and bootstrap snippets fail per tag", () => {
  const duplicate = validateIntegration({
    evidence: [
      loader("v-example-site", "network-one"),
      loader("v-example-site", "network-two"),
      dom({
        anchors: [
          { id: "v-example-site", tag: "div", parentLandmark: "main", placement: "body_content" },
          { id: "v-example-site", tag: "div", parentLandmark: "main", placement: "body_content" },
        ],
        scripts: [
          { src: "https://a.vdo.ai/core/v-example-site/vdo.ai.js", tagNameFromUrl: "v-example-site", scriptType: "classic", parentLandmark: "body" },
          { src: "https://a.vdo.ai/core/v-example-site/vdo.ai.js", tagNameFromUrl: "v-example-site", scriptType: "classic", parentLandmark: "body" },
        ],
        bootstrap: [
          { referencedTags: ["v-example-site"], parentLandmark: "body" },
          { referencedTags: ["v-example-site"], parentLandmark: "body" },
        ],
      }),
    ],
    expectation: expectation("v-example-site", { expectedBootstrapScriptCount: 1 }),
    deviceId: "desktop-chromium",
    articleEpochId: "article-one",
  });
  assert.equal(duplicate.find((item) => item.testCaseId === "TC-3")?.verdict, "FAIL");
  assert.equal(duplicate.find((item) => item.testCaseId === "TC-13")?.verdict, "FAIL");
});

test("wrong placement and unexpected removal or recreation fail DOM validation", () => {
  const result = validateIntegration({
    evidence: [loader("v-example-site"), dom({
      anchors: [{ id: "v-example-site", tag: "div", parentLandmark: "header", placement: "header" }],
      mutations: [{ kind: "anchor", identity: "v-example-site", tagName: "v-example-site", added: 2, removed: 1 }],
    })],
    expectation: expectation(),
    deviceId: "desktop-chromium",
    articleEpochId: "article-one",
  });
  const check = result.find((item) => item.testCaseId === "TC-13");
  assert.equal(check?.verdict, "FAIL");
  assert.match(JSON.stringify(check?.observed), /outside the approved body\/content position/);
  assert.match(JSON.stringify(check?.observed), /unexpected removal or recreation/);
});

test("HTTP and transport loader failures remain distinct failed observations", () => {
  for (const request of [
    loader("v-example-site", "network-http", "http_failure", 503),
    loader("v-example-site", "network-cancelled", "transport_failure", null),
  ]) {
    const result = validateIntegration({ evidence: [request, dom()], expectation: expectation(), deviceId: "desktop-chromium", articleEpochId: "article-one" });
    const check = result.find((item) => item.testCaseId === "TC-1");
    assert.equal(check?.verdict, "FAIL");
    assert.ok(check?.evidenceIds.includes(request.evidenceId));
    assert.match(JSON.stringify(check?.observed), new RegExp(String(request.data.outcome)));
  }
});

test("distinct configured -v1 and -v2 tags are not duplicates", () => {
  const tags = ["v-example-site-v1", "v-example-site-v2"];
  const sharedDom = dom({
    anchors: tags.map((id) => ({ id, tag: "div", parentLandmark: "main", placement: "body_content" })),
    scripts: tags.map((tagName) => ({ src: `https://a.vdo.ai/core/${tagName}/vdo.ai.js`, tagNameFromUrl: tagName, scriptType: "classic", parentLandmark: "body" })),
    mutations: tags.map((tagName) => ({ kind: "anchor", identity: tagName, tagName, added: 1, removed: 0 })),
  });
  const sharedEvidence = [...tags.map((tagName) => loader(tagName)), sharedDom];
  for (const tagName of tags) {
    const result = validateIntegration({ evidence: sharedEvidence, expectation: expectation(tagName), deviceId: "desktop-chromium", articleEpochId: "article-one" });
    assert.deepEqual(verdicts(result), { "TC-1": "PASS", "TC-3": "PASS", "TC-13": "PASS" });
  }
});
