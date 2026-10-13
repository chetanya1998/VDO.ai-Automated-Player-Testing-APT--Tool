import assert from "node:assert/strict";
import test from "node:test";
import { loadFixtureManifest, startFixtureServer } from "./fixtures/server.js";

test("fixture manifest is deterministic, local-only, and covers required scenario families", async () => {
  const manifest = await loadFixtureManifest();
  assert.equal(manifest.synthetic, true);
  assert.equal(manifest.externalDemandAllowed, false);
  assert.equal(manifest.fixedTimestamp, "2026-10-13T00:00:00.000Z");
  const ids = new Set(manifest.scenarios.map((scenario) => scenario.id));
  for (const required of [
    "healthy-inline-video", "missing-tag", "hidden-player", "script-failure", "no-fill",
    "stalled-response", "duplicate-implementation", "malformed-logger-payload",
    "blocked-ima-runtime", "missing-prebid-dependency", "slow-script-warning", "spa-three-articles",
  ]) assert.ok(ids.has(required), `missing scenario ${required}`);
  assert.equal(manifest.scenarios.find((scenario) => scenario.id === "spa-three-articles")!.articles.length, 3);
});

test("fixture server reproduces page, network, dependency, and demand outcomes", async () => {
  const fixture = await startFixtureServer();
  try {
    const healthy = await fetch(fixture.scenarioUrl("healthy-inline-video"));
    const healthyHtml = await healthy.text();
    assert.equal(healthy.status, 200);
    assert.equal(healthy.headers.get("x-vdo-fixture"), "synthetic");
    assert.match(healthy.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
    assert.equal((healthyHtml.match(/id="v-example-site"/g) ?? []).length, 1);
    assert.equal((healthyHtml.match(/data-synthetic-loader="true"/g) ?? []).length, 1);
    assert.doesNotMatch(healthyHtml, /https?:\/\/(?!127\.0\.0\.1)/);

    const healthyLoader = await fetch(`${fixture.origin}/core/v-example-site/vdo.ai.js?scenario=healthy-inline-video`);
    const healthyScript = await healthyLoader.text();
    assert.equal(healthyLoader.status, 200);
    assert.match(healthyScript, /Synthetic player ready/);
    assert.doesNotMatch(healthyScript, /https?:\/\//);

    const logger = await fetch(`${fixture.origin}/logger.php?scenario=healthy-inline-video`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "loaded", tagName: "v-example-site" }),
    });
    assert.equal(logger.status, 200);

    const missing = await (await fetch(fixture.scenarioUrl("missing-tag"))).text();
    assert.doesNotMatch(missing, /id="v-example-site"|data-synthetic-loader="true"/);

    const hidden = await (await fetch(fixture.scenarioUrl("hidden-player"))).text();
    assert.match(hidden, /id="v-example-site"[^>]+style="display:none"/);

    const duplicate = await (await fetch(fixture.scenarioUrl("duplicate-implementation"))).text();
    assert.equal((duplicate.match(/id="v-example-site"/g) ?? []).length, 2);
    assert.equal((duplicate.match(/data-synthetic-loader="true"/g) ?? []).length, 2);

    const failedLoader = await fetch(`${fixture.origin}/core/v-example-site/vdo.ai.js?scenario=script-failure`);
    assert.equal(failedLoader.status, 503);

    const noFill = await fetch(`${fixture.origin}/mock-demand?scenario=no-fill`);
    assert.equal(noFill.status, 204);

    const blockedIma = await fetch(`${fixture.origin}/dependencies/ima3.js?scenario=blocked-ima-runtime`);
    assert.equal(blockedIma.status, 403);
    const missingPrebid = await fetch(`${fixture.origin}/dependencies/prebid.js?scenario=missing-prebid-dependency`);
    assert.equal(missingPrebid.status, 404);

    const malformedScript = await (await fetch(`${fixture.origin}/core/v-example-site/vdo.ai.js?scenario=malformed-logger-payload`)).text();
    assert.match(malformedScript, /'\{not-json'/);
    assert.doesNotMatch(malformedScript, /https?:\/\//);

    const started = performance.now();
    const slow = await fetch(`${fixture.origin}/core/v-example-site/vdo.ai.js?scenario=slow-script-warning`);
    assert.equal(slow.status, 200);
    assert.ok(performance.now() - started >= 480, "slow fixture returned before its configured delay");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30);
    await assert.rejects(
      fetch(`${fixture.origin}/core/v-example-site/vdo.ai.js?scenario=stalled-response`, { signal: controller.signal }),
      /abort/i,
    );
    clearTimeout(timeout);
  } finally {
    await fixture.stop();
  }
});
