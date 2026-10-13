import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseBrowserLoggerPayload,
  parseEventAliasProfile,
  summarizePhysicalLoadPayloads,
} from "../src/logger/browser-payload.js";

const aliases = parseEventAliasProfile(JSON.parse(await readFile("config/event-aliases.json", "utf8")));

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "loaded",
    tagName: "v-example-site",
    domainName: "publisher.example",
    page_url: "https://publisher.example/articles/one",
    dep: "dependencies_fixture_1",
    ...overrides,
  });
}

test("logger parser retains five fields, raw names, and explicit aliases", () => {
  const result = parseBrowserLoggerPayload(body({ secret: "SECRET_SENTINEL", backendSessionId: "fabricated-key" }), "application/json", aliases);
  assert.equal(result.parseState, "parsed");
  assert.equal(result.rawEvent, "loaded");
  assert.equal(result.canonicalEvent, "loaded");
  assert.equal(result.ignoredFieldCount, 2);
  assert.deepEqual(Object.keys(result.fields).sort(), ["dep", "domainName", "event", "page_url", "tagName"]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_SENTINEL|fabricated-key|backendSessionId/);
});

test("missing, empty, invalid, malformed, and unknown values warn without throwing", () => {
  const invalid = parseBrowserLoggerPayload(body({ event: "Future Event", tagName: "", domainName: 4, page_url: "file:///tmp/page", dep: undefined }), "application/json", aliases);
  assert.equal(invalid.rawEvent, "Future Event");
  assert.equal(invalid.canonicalEvent, null);
  assert.ok(invalid.diagnostics.some((item) => item.code === "unknown_event"));
  assert.ok(invalid.diagnostics.some((item) => item.code === "empty_field" && item.field === "tagName"));
  assert.ok(invalid.diagnostics.some((item) => item.code === "invalid_field" && item.field === "domainName"));
  assert.ok(invalid.diagnostics.some((item) => item.code === "invalid_field" && item.field === "page_url"));
  assert.ok(invalid.diagnostics.some((item) => item.code === "missing_field" && item.field === "dep"));

  const malformed = parseBrowserLoggerPayload("{not-json", "application/json", aliases);
  assert.equal(malformed.parseState, "malformed");
  assert.equal(malformed.diagnostics[0]?.code, "malformed_body");
});

test("form bodies are supported and physical-load dep changes fail independently of mixed tags", () => {
  const first = parseBrowserLoggerPayload(new URLSearchParams({
    event: "Pageview",
    tagName: "v-one",
    domainName: "publisher.example",
    page_url: "https://publisher.example/articles/one",
    dep: "dependencies_fixture_1",
  }).toString(), "application/x-www-form-urlencoded", aliases);
  const second = parseBrowserLoggerPayload(body({ tagName: "v-two", dep: "dependencies_dev_3153" }), "application/json", aliases);
  const summary = summarizePhysicalLoadPayloads([first, second]);

  assert.deepEqual(summary.tagNames, ["v-one", "v-two"]);
  assert.deepEqual(summary.depValues, ["dependencies_dev_3153", "dependencies_fixture_1"]);
  assert.ok(summary.diagnostics.some((item) => item.code === "dep_changed" && item.severity === "failure"));
  assert.ok(summary.diagnostics.some((item) => item.code === "development_dep_observed" && item.severity === "information"));
  assert.equal(summary.diagnostics.some((item) => item.field === "tagName"), false);
});
