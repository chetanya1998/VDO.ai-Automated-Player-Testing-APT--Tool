import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseSiteProfileCatalog,
  proposeTagCandidates,
  resolveTagIdentity,
  validateTagSet,
} from "../src/profile/tag-identity.js";

const catalog = parseSiteProfileCatalog(JSON.parse(await readFile("config/site-profiles.json", "utf8")));

test("approved insights.dsij.in video tags and suffix variants resolve explicitly", () => {
  for (const tagName of ["v-dsij-in", "v-dsij-in-v1", "v-dsij-in-v2"]) {
    const result = resolveTagIdentity({
      siteUrl: "https://insights.dsij.in/article/markets",
      observedTagName: tagName,
      observedDomainName: "insights.dsij.in",
      activeProduct: "video",
    }, catalog);
    assert.equal(result.verdict, "PASS");
    assert.equal(result.mappingId, "dsij-approved-products");
    assert.equal(result.expectedRootDomain, "dsij.in");
    assert.equal(result.matchedTag?.placement, "inline_body_content");
    assert.equal(result.matchedTag?.floatingMode, "inline");
  }
});

test("approved multipart domains and host-derived candidates keep the registrable label", () => {
  const result = resolveTagIdentity({
    siteUrl: "https://markets.example.co.in/story/1",
    observedTagName: "v-example-co-in",
    observedDomainName: "markets.example.co.in",
    activeProduct: "video",
  }, catalog);
  assert.equal(result.verdict, "PASS");
  assert.deepEqual(proposeTagCandidates("https://news.example.co.in/path"), [
    "v-example-co-in",
    "c-example-co-in",
    "s-example-co-in",
    "b-example-co-in",
  ]);
});

test("multiple approved tags stay separate and are legitimate", () => {
  const result = validateTagSet({
    siteUrl: "https://insights.dsij.in/article/markets",
    observations: [
      { tagName: "v-dsij-in", domainName: "insights.dsij.in" },
      { tagName: "c-dsij-in-v1", domainName: "dsij.in" },
    ],
  }, catalog);
  assert.equal(result.verdict, "PASS");
  assert.equal(result.identities.length, 2);
  assert.deepEqual(result.identities.map((identity) => identity.matchedTag?.product), ["video", "carousel"]);
});

test("confirmed domain, tag, and product mismatches fail", () => {
  const wrongDomain = resolveTagIdentity({
    siteUrl: "https://insights.dsij.in/article/markets",
    observedTagName: "v-dsij-in",
    observedDomainName: "attacker.example",
    activeProduct: "video",
  }, catalog);
  const wrongTag = resolveTagIdentity({
    siteUrl: "https://insights.dsij.in/article/markets",
    observedTagName: "v-unapproved",
    observedDomainName: "insights.dsij.in",
    activeProduct: "video",
  }, catalog);
  const wrongProduct = resolveTagIdentity({
    siteUrl: "https://insights.dsij.in/article/markets",
    observedTagName: "b-dsij-in",
    observedDomainName: "insights.dsij.in",
    activeProduct: "video",
  }, catalog);
  assert.equal(wrongDomain.reason, "domain_mismatch");
  assert.equal(wrongDomain.verdict, "FAIL");
  assert.equal(wrongTag.reason, "tag_mismatch");
  assert.equal(wrongTag.verdict, "FAIL");
  assert.equal(wrongProduct.reason, "product_mismatch");
  assert.equal(wrongProduct.verdict, "FAIL");
});

test("missing mappings and missing observed fields remain unknown", () => {
  const unmapped = resolveTagIdentity({
    siteUrl: "https://news.dsij.in/article/markets",
    observedTagName: "v-dsij-in",
    observedDomainName: "news.dsij.in",
  }, catalog);
  const missingTag = resolveTagIdentity({
    siteUrl: "https://insights.dsij.in/article/markets",
    observedTagName: null,
    observedDomainName: "insights.dsij.in",
  }, catalog);
  assert.equal(unmapped.verdict, "UNKNOWN");
  assert.equal(unmapped.reason, "site_mapping_missing");
  assert.ok(unmapped.candidateTags.includes("v-dsij-in"));
  assert.match(unmapped.detail, /do not prove ownership/);
  assert.equal(missingTag.verdict, "UNKNOWN");
  assert.equal(missingTag.reason, "tag_missing");
});

test("v/c/s/b identities are explicit and non-video rules stay unsupported", () => {
  const expected = { v: "video", c: "carousel", s: "story", b: "banner" } as const;
  assert.deepEqual(catalog.productPrefixes, expected);
  for (const [prefix, product] of Object.entries(expected)) {
    const result = resolveTagIdentity({
      siteUrl: "https://insights.dsij.in/article/markets",
      observedTagName: `${prefix}-dsij-in`,
      observedDomainName: "insights.dsij.in",
      activeProduct: product,
    }, catalog);
    assert.equal(result.verdict, "PASS");
    assert.equal(result.matchedTag?.product, product);
    if (product === "video") {
      assert.equal(result.ruleSupport, "supported");
    } else {
      assert.equal(result.ruleSupport, "unsupported");
      assert.equal(result.matchedTag?.placement, "unconfirmed");
      assert.equal(result.matchedTag?.floatingMode, "unconfirmed");
    }
  }
});
