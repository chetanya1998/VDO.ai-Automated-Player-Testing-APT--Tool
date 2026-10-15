import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { runBrowser } from "./browser/run.js";
import { createQueuedRun, parseArticleEpoch, parseProfile, parseRun, type CheckResult, type Profile } from "./contracts.js";
import { normalizeEvidence } from "./evidence/normalize.js";
import { parseEventAliasProfile } from "./logger/browser-payload.js";
import type { Product, SiteTagProfile } from "./profile/tag-identity.js";
import { buildReport } from "./report/build.js";
import { applyRuntimeContext, parseRuntimePolicy, validateBlockedEvents } from "./rules/blocked.js";
import { applyAuctionContext, parseAuctionPolicy, validateAuction } from "./rules/auction.js";
import { applyDemandContext, parseDemandPolicy, validateDemand } from "./rules/demand.js";
import { validateDependencies } from "./rules/dependencies.js";
import { parseEventRulePolicy, validateEvents } from "./rules/events.js";
import { validateIntegration, type IntegrationExpectation } from "./rules/integration.js";
import { validateLayout } from "./rules/layout.js";
import { validateLoggerPresence } from "./rules/logger-presence.js";
import { parseTimingPolicy, validateTiming } from "./rules/timing.js";
import { applyViewabilityContext, applyVisibilityContext, parseVisibilityPolicy, validateViewability } from "./rules/viewability.js";

interface ReportArguments {
  targetUrl: string;
  profilePath: string;
  outputPath: string;
  browserPath: string;
  aliasesPath: string;
  timingPath: string;
  eventRulesPath: string;
  runtimePolicyPath: string;
  demandPolicyPath: string;
  auctionPolicyPath: string;
  visibilityPolicyPath: string;
  deviceId?: string;
  observeMs: number;
  timeoutMs: number;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function nonnegativeInteger(value: unknown, path: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(parsed) || Number(parsed) < 0) throw new TypeError(`${path} must be a non-negative integer`);
  return Number(parsed);
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = nonnegativeInteger(value, path);
  if (parsed === 0) throw new TypeError(`${path} must be a positive integer`);
  return parsed;
}

function option(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1];
}

function reportArguments(args: string[]): ReportArguments {
  const [targetUrl, profilePath, outputPath] = args;
  if (!targetUrl || !profilePath || !outputPath) throw new Error("usage: report <url> <profile.json> <output.json> --browser <executable> --aliases <aliases.json> --timing <timing.json> --event-rules <rules.json> --runtime-policy <policy.json> --demand-policy <policy.json> --auction-rules <rules.json> --visibility-policy <policy.json> [--device <id>] [--observe-ms <ms>] [--timeout-ms <ms>]");
  const deviceId = option(args, "--device");
  return {
    targetUrl,
    profilePath,
    outputPath,
    browserPath: nonempty(option(args, "--browser", process.env.VDO_VALIDATOR_BROWSER), "--browser or VDO_VALIDATOR_BROWSER"),
    aliasesPath: nonempty(option(args, "--aliases"), "--aliases"),
    timingPath: nonempty(option(args, "--timing"), "--timing"),
    eventRulesPath: nonempty(option(args, "--event-rules"), "--event-rules"),
    runtimePolicyPath: nonempty(option(args, "--runtime-policy"), "--runtime-policy"),
    demandPolicyPath: nonempty(option(args, "--demand-policy"), "--demand-policy"),
    auctionPolicyPath: nonempty(option(args, "--auction-rules"), "--auction-rules"),
    visibilityPolicyPath: nonempty(option(args, "--visibility-policy"), "--visibility-policy"),
    ...(deviceId === undefined ? {} : { deviceId }),
    observeMs: nonnegativeInteger(option(args, "--observe-ms", "5000"), "--observe-ms"),
    timeoutMs: positiveInteger(option(args, "--timeout-ms", "300000"), "--timeout-ms"),
  };
}

function selectedDevice(profile: Profile, requested: string | undefined): Profile["devices"][number] {
  const device = requested === undefined
    ? profile.devices.find((item) => item.state === "enabled")
    : profile.devices.find((item) => item.id === requested && item.state === "enabled");
  if (device === undefined) throw new TypeError(`enabled device not found: ${requested ?? "profile default"}`);
  return device;
}

function integrationExpectation(rawProfile: unknown): IntegrationExpectation {
  const root = object(rawProfile, "profile");
  const tag = object(root.tag, "profile.tag");
  const player = object(root.player, "profile.player");
  const features = object(player.features, "profile.player.features");
  const anchor = object(features.anchor, "profile.player.features.anchor");
  const floating = object(features.floating, "profile.player.features.floating");
  if (!Array.isArray(tag.expected) || tag.expected.length !== 1) throw new TypeError("profile.tag.expected must contain exactly one tag for Task 08");
  const tagName = nonempty(tag.expected[0], "profile.tag.expected[0]");
  const product = nonempty(player.product, "profile.player.product") as Product;
  if (!(["video", "carousel", "story", "banner"] as string[]).includes(product)) throw new TypeError("profile.player.product is unsupported");
  const floatingMode = floating.state === "enabled" ? "floating" : floating.state === "disabled" ? "inline" : "unconfirmed";
  const siteTag: SiteTagProfile = {
    baseTag: tagName,
    allowedTagNames: [tagName],
    product,
    placement: player.placement === "inline_body_content" ? "inline_body_content" : floatingMode === "floating" ? "floating" : "unconfirmed",
    floatingMode,
    ruleSupport: product === "video" ? "supported" : "unsupported",
  };
  return {
    tag: siteTag,
    tagName,
    loaderUrl: nonempty(tag.loaderUrl, "profile.tag.loaderUrl"),
    expectedRequestCount: positiveInteger(tag.expectedRequestCount, "profile.tag.expectedRequestCount"),
    expectedExternalScriptCount: positiveInteger(tag.expectedExternalScriptCount, "profile.tag.expectedExternalScriptCount"),
    expectedBootstrapScriptCount: nonnegativeInteger(tag.expectedBootstrapScriptCount, "profile.tag.expectedBootstrapScriptCount"),
    expectedAnchorCount: nonnegativeInteger(anchor.expectedCount, "profile.player.features.anchor.expectedCount"),
    expectedScriptType: nonempty(tag.expectedScriptType, "profile.tag.expectedScriptType"),
  };
}

function approvedOrigins(profile: Profile): string[] {
  return [...new Set([
    ...profile.site.approvedUrls.map((value) => new URL(value).origin),
    ...(profile.site.approvedResourceOrigins ?? []).map((value) => new URL(value).origin),
  ])];
}

function articleUrl(finalUrl: string | null, fallback: string): string {
  if (finalUrl === null) return fallback;
  try {
    const parsed = new URL(finalUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? finalUrl : fallback;
  } catch {
    return fallback;
  }
}

function markExecutionUnverified(checks: readonly CheckResult[], reason: string): CheckResult[] {
  return checks.map((check) => ({
    ...check,
    verdict: "UNKNOWN",
    category: "TOOLING",
    observed: { state: "execution_error", reason, capturedObservation: check.observed },
  }));
}

async function generateReport(args: string[]): Promise<void> {
  const input = reportArguments(args);
  await access(input.browserPath);
  const rawProfile: unknown = JSON.parse(await readFile(input.profilePath, "utf8"));
  const profile = parseProfile(rawProfile);
  if (profile.profileStatus !== "production") throw new TypeError("report requires a production profile; fixture-only profiles are rejected by the no-mocks policy");
  if (!profile.site.approvedUrls.includes(input.targetUrl)) throw new TypeError("target URL is not listed in profile.site.approvedUrls");
  const aliases = parseEventAliasProfile(JSON.parse(await readFile(input.aliasesPath, "utf8")));
  if (aliases.status !== "confirmed" || aliases.profileId !== profile.profileId) throw new TypeError("report requires confirmed event aliases for the selected profile");
  const timing = parseTimingPolicy(JSON.parse(await readFile(input.timingPath, "utf8")));
  if (timing.status !== "confirmed") throw new TypeError("report requires a confirmed timing policy");
  const eventRules = parseEventRulePolicy(JSON.parse(await readFile(input.eventRulesPath, "utf8")));
  if (eventRules.status !== "confirmed" || eventRules.profileId !== profile.profileId) throw new TypeError("report requires confirmed event rules for the selected profile");
  const runtimePolicy = parseRuntimePolicy(JSON.parse(await readFile(input.runtimePolicyPath, "utf8")));
  if (runtimePolicy.status !== "confirmed" || runtimePolicy.profileId !== profile.profileId) throw new TypeError("report requires a confirmed runtime policy for the selected profile");
  const demandPolicy = parseDemandPolicy(JSON.parse(await readFile(input.demandPolicyPath, "utf8")));
  if (demandPolicy.status !== "confirmed" || demandPolicy.profileId !== profile.profileId) throw new TypeError("report requires a confirmed demand policy for the selected profile");
  const auctionPolicy = parseAuctionPolicy(JSON.parse(await readFile(input.auctionPolicyPath, "utf8")));
  if (auctionPolicy.status !== "confirmed" || auctionPolicy.profileId !== profile.profileId) throw new TypeError("report requires confirmed auction rules for the selected profile");
  const visibilityPolicy = parseVisibilityPolicy(JSON.parse(await readFile(input.visibilityPolicyPath, "utf8")));
  if (visibilityPolicy.status !== "confirmed" || visibilityPolicy.profileId !== profile.profileId) throw new TypeError("report requires a confirmed visibility policy for the selected profile");
  const device = selectedDevice(profile, input.deviceId);
  const viewport = object(device.viewport, `profile.devices.${device.id}.viewport`);
  const expectation = integrationExpectation(rawProfile);
  const runId = `run-${randomUUID()}`;
  const queued = createQueuedRun({
    runId,
    profileId: profile.profileId,
    targetUrl: input.targetUrl,
    deviceId: device.id,
    createdAt: new Date().toISOString(),
  });
  const browser = await runBrowser({
    targetUrl: input.targetUrl,
    approvedOrigins: approvedOrigins(profile),
    allowRemoteOrigins: true,
    browserExecutablePath: input.browserPath,
    viewport: {
      width: positiveInteger(viewport.width, `profile.devices.${device.id}.viewport.width`),
      height: positiveInteger(viewport.height, `profile.devices.${device.id}.viewport.height`),
    },
    navigationTimeoutMs: Math.min(30_000, input.timeoutMs),
    totalTimeoutMs: input.timeoutMs,
    observeAfterLoadMs: input.observeMs,
    visibilitySampleIntervalMs: visibilityPolicy.sampleIntervalMs,
  });
  const executionState = browser.status === "completed" ? "completed" : browser.status === "timed_out" ? "timed_out" : "errored";
  const run = parseRun({ ...queued, executionState });
  const articleEpoch = parseArticleEpoch({
    schemaVersion: 1,
    articleEpochId: `${runId}-article-1`,
    runId,
    sequence: 0,
    url: articleUrl(browser.metadata.finalUrl, input.targetUrl),
    startedAt: browser.startedAt,
    endedAt: browser.endedAt,
  });
  const bundle = normalizeEvidence({
    run,
    capture: browser.capture,
    articleEpochs: [articleEpoch],
    profile,
    eventAliases: aliases,
    physicalLoadId: `${runId}-load-1`,
  });
  const shared = {
    evidence: bundle.evidence,
    deviceId: run.deviceId,
    articleEpochId: articleEpoch.articleEpochId,
    tagName: expectation.tagName,
  };
  const eventChecks = validateEvents({
    evidence: bundle.evidence,
    policy: eventRules,
    deviceId: run.deviceId,
    articleEpochId: articleEpoch.articleEpochId,
    activeTags: [expectation.tagName],
    captureComplete: browser.status === "completed" && browser.capture.complete,
  });
  const runtimeShared = {
    evidence: bundle.evidence,
    policy: runtimePolicy,
    profileId: profile.profileId,
    product: expectation.tag.product,
    deviceId: run.deviceId,
    articleEpochId: articleEpoch.articleEpochId,
    tagName: expectation.tagName,
    captureComplete: browser.status === "completed" && browser.capture.complete,
  };
  const dependencies = validateDependencies(runtimeShared);
  const blocked = validateBlockedEvents(runtimeShared);
  const demand = validateDemand({ ...runtimeShared, policy: demandPolicy });
  const auction = validateAuction({ ...runtimeShared, policy: auctionPolicy, demandPolicy });
  const viewability = validateViewability({ ...runtimeShared, policy: visibilityPolicy });
  const layout = validateLayout(runtimeShared);
  const evaluatedChecks = [
    ...validateIntegration({ ...shared, expectation }),
    ...validateTiming({
      ...shared,
      policy: timing,
      loaderUrl: expectation.loaderUrl,
      captureContext: { coldCache: browser.metadata.coldCache, networkConditions: browser.metadata.networkConditions },
    }),
    validateLoggerPresence({
      ...shared,
      loaderUrl: expectation.loaderUrl,
      captureComplete: browser.status === "completed" && browser.capture.complete,
    }),
    ...applyDemandContext(applyRuntimeContext(applyVisibilityContext(eventChecks, viewability), blocked, dependencies), demand),
    viewability.tc8,
    blocked.check,
    dependencies,
    applyAuctionContext(applyViewabilityContext(demand.check, viewability), auction),
    layout,
  ];
  const checks = browser.status === "runner_error"
    ? markExecutionUnverified(evaluatedChecks, browser.errors.map((error) => error.message).join("; ") || "browser runner error")
    : evaluatedChecks;
  const report = buildReport({
    reportId: `report-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    bundle,
    checks,
    captureComplete: browser.status === "completed" && browser.capture.complete,
    executionErrors: browser.errors,
  });
  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({
    reportPath: input.outputPath,
    runId: report.runId,
    executionState: report.executionState,
    overallVerdict: report.overallVerdict,
    verdictCounts: report.verdictCounts,
  }, null, 2));
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "report") return generateReport(args);
  if (command === "validate-profile" && args[0]) {
    const profile = parseProfile(JSON.parse(await readFile(args[0], "utf8")));
    console.log(JSON.stringify({
      profileId: profile.profileId,
      profileStatus: profile.profileStatus,
      approvedUrls: profile.site.approvedUrls,
      devices: profile.devices.map((device) => device.id),
    }, null, 2));
    return;
  }
  throw new Error("usage: validate-profile <profile.json> | report <url> <profile.json> <output.json> --browser <executable> --aliases <aliases.json> --timing <timing.json> --event-rules <rules.json> --runtime-policy <policy.json> --demand-policy <policy.json> --auction-rules <rules.json> --visibility-policy <policy.json>");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
