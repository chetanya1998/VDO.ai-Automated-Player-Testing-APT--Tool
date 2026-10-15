import type { CheckResult, Evidence, IssueCategory, JsonValue, Verdict } from "../contracts.js";
import { parseDemandResponse, type ParsedDemandState } from "../demand/parse.js";
import type { DemandPolicy } from "./demand.js";

export interface AuctionPolicy {
  schemaVersion: number;
  policyId: string;
  profileId: string;
  status: "draft" | "confirmed";
  products: Array<{
    product: string;
    cycleStartProvider: string;
    refreshMinimumGapMs: number;
    stages: Array<{
      id: string;
      mode: "parallel" | "waterfall";
      providers: string[];
      dependsOn: string[];
      timeoutMs: number;
      maxStartSpreadMs?: number;
    }>;
    fallbacks: Array<{
      fromProvider: string;
      toProvider: string;
      on: Array<"no_fill" | "no_bid" | "failed" | "timeout">;
      required: boolean;
      maxDelayMs: number;
    }>;
  }>;
}

export interface AuctionValidationInput {
  evidence: readonly Evidence[];
  policy: AuctionPolicy;
  demandPolicy: DemandPolicy;
  profileId: string;
  product: string;
  deviceId: string;
  articleEpochId: string;
  captureComplete: boolean;
}

export interface AuctionValidation {
  verdict: Verdict;
  category: IssueCategory;
  expected: JsonValue;
  observed: JsonValue;
  evidenceIds: string[];
}

type ProductPolicy = AuctionPolicy["products"][number];
type Stage = ProductPolicy["stages"][number];
type Request = { evidence: Evidence; providerId: string; startedMs: number; durationMs: number | null; state: ParsedDemandState };
type Issue = { code: string; policyId: string; configVersion: number; cycle: number | null; stageId: string | null; evidenceIds: string[]; detail: JsonValue };

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function strings(value: unknown, path: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new TypeError(`${path} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  return value.map((item, index) => text(item, `${path}[${index}]`));
}

function integer(value: unknown, path: string, allowZero = false): number {
  if (!Number.isInteger(value) || Number(value) < (allowZero ? 0 : 1)) throw new TypeError(`${path} must be a ${allowZero ? "non-negative" : "positive"} integer`);
  return Number(value);
}

export function parseAuctionPolicy(value: unknown): AuctionPolicy {
  const root = object(value, "auctionPolicy");
  const schemaVersion = integer(root.schemaVersion, "auctionPolicy.schemaVersion");
  const policyId = text(root.policyId, "auctionPolicy.policyId");
  const profileId = text(root.profileId, "auctionPolicy.profileId");
  if (root.status !== "draft" && root.status !== "confirmed") throw new TypeError("auctionPolicy.status must be draft or confirmed");
  if (!Array.isArray(root.products) || root.products.length === 0) throw new TypeError("auctionPolicy.products must be a non-empty array");
  const products = root.products.map((rawProduct, productIndex) => {
    const path = `auctionPolicy.products[${productIndex}]`;
    const item = object(rawProduct, path);
    if (!Array.isArray(item.stages) || item.stages.length === 0) throw new TypeError(`${path}.stages must be a non-empty array`);
    const stages = item.stages.map((rawStage, stageIndex) => {
      const stagePath = `${path}.stages[${stageIndex}]`;
      const stage = object(rawStage, stagePath);
      if (stage.mode !== "parallel" && stage.mode !== "waterfall") throw new TypeError(`${stagePath}.mode must be parallel or waterfall`);
      const parsed = {
        id: text(stage.id, `${stagePath}.id`),
        mode: stage.mode as Stage["mode"],
        providers: strings(stage.providers, `${stagePath}.providers`),
        dependsOn: strings(stage.dependsOn, `${stagePath}.dependsOn`, true),
        timeoutMs: integer(stage.timeoutMs, `${stagePath}.timeoutMs`),
        ...(stage.maxStartSpreadMs === undefined ? {} : { maxStartSpreadMs: integer(stage.maxStartSpreadMs, `${stagePath}.maxStartSpreadMs`, true) }),
      };
      if (parsed.mode === "parallel" && parsed.providers.length > 1 && parsed.maxStartSpreadMs === undefined) throw new TypeError(`${stagePath}.maxStartSpreadMs is required for parallel stages`);
      return parsed;
    });
    if (new Set(stages.map((stage) => stage.id)).size !== stages.length) throw new TypeError(`${path} stage ids must be unique`);
    for (const stage of stages) if (stage.dependsOn.some((id) => !stages.some((candidate) => candidate.id === id))) throw new TypeError(`${path} stage dependency is unknown`);
    if (!Array.isArray(item.fallbacks)) throw new TypeError(`${path}.fallbacks must be an array`);
    const fallbacks = item.fallbacks.map((rawFallback, fallbackIndex) => {
      const fallbackPath = `${path}.fallbacks[${fallbackIndex}]`;
      const fallback = object(rawFallback, fallbackPath);
      const on = strings(fallback.on, `${fallbackPath}.on`) as Array<"no_fill" | "no_bid" | "failed" | "timeout">;
      if (on.some((state) => !["no_fill", "no_bid", "failed", "timeout"].includes(state))) throw new TypeError(`${fallbackPath}.on contains an unsupported outcome`);
      if (typeof fallback.required !== "boolean") throw new TypeError(`${fallbackPath}.required must be boolean`);
      return {
        fromProvider: text(fallback.fromProvider, `${fallbackPath}.fromProvider`),
        toProvider: text(fallback.toProvider, `${fallbackPath}.toProvider`),
        on,
        required: fallback.required,
        maxDelayMs: integer(fallback.maxDelayMs, `${fallbackPath}.maxDelayMs`),
      };
    });
    return {
      product: text(item.product, `${path}.product`),
      cycleStartProvider: text(item.cycleStartProvider, `${path}.cycleStartProvider`),
      refreshMinimumGapMs: integer(item.refreshMinimumGapMs, `${path}.refreshMinimumGapMs`, true),
      stages,
      fallbacks,
    };
  });
  if (new Set(products.map((item) => item.product)).size !== products.length) throw new TypeError("auctionPolicy product names must be unique");
  return { schemaVersion, policyId, profileId, status: root.status, products };
}

function requestUrl(item: Evidence): URL | null {
  if (item.source !== "browser_network" || item.data.kind !== "request" || typeof item.data.url !== "string") return null;
  try { return new URL(item.data.url); } catch { return null; }
}

function stageFor(policy: ProductPolicy, providerId: string): Stage | undefined {
  return policy.stages.find((stage) => stage.providers.includes(providerId));
}

function readyAt(request: Request, stage: Stage): number {
  return request.startedMs + Math.min(request.durationMs ?? stage.timeoutMs, stage.timeoutMs);
}

function issue(policy: AuctionPolicy, code: string, cycle: number | null, stageId: string | null, evidenceIds: string[], detail: JsonValue): Issue {
  return { code, policyId: policy.policyId, configVersion: policy.schemaVersion, cycle, stageId, evidenceIds, detail };
}

function validateCycle(policy: AuctionPolicy, productPolicy: ProductPolicy, requests: Request[], cycle: number): Issue[] {
  const issues: Issue[] = [];
  const byProvider = (id: string) => requests.filter((request) => request.providerId === id);
  for (const stage of productPolicy.stages) {
    const observed = stage.providers.map((id) => byProvider(id)[0]);
    const missing = stage.providers.filter((_, index) => observed[index] === undefined);
    if (missing.length > 0) issues.push(issue(policy, "missing_stage_provider", cycle, stage.id, observed.flatMap((item) => item === undefined ? [] : [item.evidence.evidenceId]), { providers: missing }));
    const present = observed.filter((item): item is Request => item !== undefined);
    if (stage.mode === "parallel" && present.length > 1) {
      const starts = present.map((item) => item.startedMs);
      if (Math.max(...starts) - Math.min(...starts) > (stage.maxStartSpreadMs ?? 0)) issues.push(issue(policy, "parallel_start_spread_exceeded", cycle, stage.id, present.map((item) => item.evidence.evidenceId), { allowedMs: stage.maxStartSpreadMs ?? 0, observedMs: Math.max(...starts) - Math.min(...starts) }));
    }
    if (stage.mode === "waterfall") {
      for (let index = 1; index < observed.length; index += 1) {
        const previous = observed[index - 1];
        const current = observed[index];
        if (previous !== undefined && current !== undefined && current.startedMs < readyAt(previous, stage)) issues.push(issue(policy, "premature_request", cycle, stage.id, [previous.evidence.evidenceId, current.evidence.evidenceId], { provider: current.providerId, allowedAfterMs: readyAt(previous, stage), observedMs: current.startedMs }));
      }
    }
    for (const dependencyId of stage.dependsOn) {
      const dependency = productPolicy.stages.find((item) => item.id === dependencyId)!;
      const dependencyRequests = dependency.providers.map((id) => byProvider(id)[0]);
      if (dependencyRequests.some((item) => item === undefined) || present.length === 0) continue;
      const allowedAfterMs = Math.max(...dependencyRequests.map((item) => readyAt(item!, dependency)));
      const first = present.reduce((left, right) => left.startedMs <= right.startedMs ? left : right);
      if (first.startedMs < allowedAfterMs) issues.push(issue(policy, "premature_request", cycle, stage.id, [...dependencyRequests.map((item) => item!.evidence.evidenceId), first.evidence.evidenceId], { provider: first.providerId, dependency: dependencyId, allowedAfterMs, observedMs: first.startedMs }));
    }
  }
  for (const fallback of productPolicy.fallbacks) {
    const source = byProvider(fallback.fromProvider)[0];
    if (source === undefined) continue;
    const sourceStage = stageFor(productPolicy, fallback.fromProvider);
    const outcome = sourceStage !== undefined && source.durationMs !== null && source.durationMs > sourceStage.timeoutMs ? "timeout" : source.state;
    if (!fallback.on.includes(outcome as "no_fill" | "no_bid" | "failed" | "timeout")) continue;
    const target = byProvider(fallback.toProvider)[0];
    if (target === undefined) {
      if (fallback.required) issues.push(issue(policy, "missing_required_fallback", cycle, sourceStage?.id ?? null, [source.evidence.evidenceId], { fromProvider: fallback.fromProvider, toProvider: fallback.toProvider, outcome }));
      continue;
    }
    const allowedAfterMs = sourceStage === undefined ? source.startedMs + (source.durationMs ?? 0) : readyAt(source, sourceStage);
    if (target.startedMs < allowedAfterMs) issues.push(issue(policy, "premature_fallback", cycle, sourceStage?.id ?? null, [source.evidence.evidenceId, target.evidence.evidenceId], { fromProvider: fallback.fromProvider, toProvider: fallback.toProvider, allowedAfterMs, observedMs: target.startedMs }));
    else if (target.startedMs > allowedAfterMs + fallback.maxDelayMs) issues.push(issue(policy, "fallback_delay_exceeded", cycle, sourceStage?.id ?? null, [source.evidence.evidenceId, target.evidence.evidenceId], { fromProvider: fallback.fromProvider, toProvider: fallback.toProvider, allowedByMs: allowedAfterMs + fallback.maxDelayMs, observedMs: target.startedMs }));
  }
  return issues;
}

export function validateAuction(input: AuctionValidationInput): AuctionValidation {
  const policy = parseAuctionPolicy(input.policy);
  if (policy.profileId !== input.profileId) throw new TypeError("auction policy profile does not match the selected profile");
  const expected = { policyId: policy.policyId, configVersion: policy.schemaVersion, state: policy.status, product: input.product };
  if (policy.status !== "confirmed") return { verdict: "UNKNOWN", category: "TOOLING", expected, observed: { cause: "auction_policy_unconfirmed", cycles: [] }, evidenceIds: [] };
  const productPolicy = policy.products.find((item) => item.product === input.product);
  if (productPolicy === undefined) return { verdict: "UNKNOWN", category: "TOOLING", expected, observed: { cause: "auction_configuration_unknown", cycles: [] }, evidenceIds: [] };
  const demandProviders = new Map(input.demandPolicy.providers.filter((item) => item.products.includes(input.product)).map((item) => [item.id, item]));
  const referenced = new Set([productPolicy.cycleStartProvider, ...productPolicy.stages.flatMap((stage) => stage.providers), ...productPolicy.fallbacks.flatMap((fallback) => [fallback.fromProvider, fallback.toProvider])]);
  const unknownProviders = [...referenced].filter((id) => !demandProviders.has(id));
  if (unknownProviders.length > 0) return { verdict: "UNKNOWN", category: "TOOLING", expected, observed: { cause: "auction_provider_configuration_unknown", providers: unknownProviders }, evidenceIds: [] };
  const scoped = input.evidence.filter((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId);
  const requests: Request[] = [];
  for (const evidence of scoped) {
    const url = requestUrl(evidence);
    if (url === null || typeof evidence.data.startedMs !== "number") continue;
    const provider = [...demandProviders.values()].find((item) => item.pathContains.some((part) => url.pathname.includes(part)));
    if (provider === undefined) continue;
    requests.push({ evidence, providerId: provider.id, startedMs: evidence.data.startedMs, durationMs: typeof evidence.data.durationMs === "number" ? evidence.data.durationMs : null, state: parseDemandResponse(evidence, provider.format, input.demandPolicy.limits).state });
  }
  requests.sort((a, b) => a.startedMs - b.startedMs || a.evidence.evidenceId.localeCompare(b.evidence.evidenceId));
  const anchors = requests.filter((request) => request.providerId === productPolicy.cycleStartProvider);
  if (anchors.length === 0) {
    if (input.captureComplete && requests.length > 0) {
      const missingStart = issue(policy, "cycle_start_missing", null, null, requests.map((item) => item.evidence.evidenceId), { cycleStartProvider: productPolicy.cycleStartProvider });
      return { verdict: "FAIL", category: "RUNTIME_BROWSER", expected, observed: { cycles: [], issues: [missingStart] }, evidenceIds: missingStart.evidenceIds };
    }
    return { verdict: "UNKNOWN", category: "TOOLING", expected, observed: { cause: input.captureComplete ? "auction_cycle_not_observed" : "capture_incomplete", cycles: [] }, evidenceIds: [] };
  }
  const issues: Issue[] = [];
  const before = requests.filter((request) => request.startedMs < anchors[0]!.startedMs);
  if (before.length > 0) issues.push(issue(policy, "request_before_cycle_start", null, null, before.map((item) => item.evidence.evidenceId), { cycleStartProvider: productPolicy.cycleStartProvider }));
  const cycles = anchors.map((anchor, index) => {
    const next = anchors[index + 1];
    const cycleRequests = requests.filter((request) => request.startedMs >= anchor.startedMs && (next === undefined || request.startedMs < next.startedMs));
    issues.push(...validateCycle(policy, productPolicy, cycleRequests, index + 1));
    if (index > 0) {
      const previous = anchors[index - 1]!;
      const gapMs = anchor.startedMs - previous.startedMs;
      if (gapMs < productPolicy.refreshMinimumGapMs) issues.push(issue(policy, "refresh_too_early", index + 1, null, [previous.evidence.evidenceId, anchor.evidence.evidenceId], { minimumGapMs: productPolicy.refreshMinimumGapMs, observedGapMs: gapMs }));
    }
    return {
      cycle: index + 1,
      startEvidenceId: anchor.evidence.evidenceId,
      requests: cycleRequests.map((request) => ({ providerId: request.providerId, evidenceId: request.evidence.evidenceId, startedMs: request.startedMs, durationMs: request.durationMs, outcome: stageFor(productPolicy, request.providerId) !== undefined && request.durationMs !== null && request.durationMs > stageFor(productPolicy, request.providerId)!.timeoutMs ? "timeout" : request.state })),
    };
  });
  const evidenceIds = [...new Set([...requests.map((item) => item.evidence.evidenceId), ...issues.flatMap((item) => item.evidenceIds)])];
  return {
    verdict: issues.length === 0 ? "PASS" : "FAIL",
    category: issues.length === 0 ? "NONE" : "RUNTIME_BROWSER",
    expected: { ...expected, cycleStartProvider: productPolicy.cycleStartProvider, refreshMinimumGapMs: productPolicy.refreshMinimumGapMs, stages: productPolicy.stages, fallbacks: productPolicy.fallbacks },
    observed: { cycles, issues },
    evidenceIds,
  };
}

const rank: Record<Verdict, number> = { NOT_APPLICABLE: 0, PASS: 1, WARNING: 2, UNKNOWN: 3, FAIL: 4 };

export function applyAuctionContext(check: CheckResult, auction: AuctionValidation): CheckResult {
  const observed = typeof check.observed === "object" && check.observed !== null && !Array.isArray(check.observed) ? check.observed : { demand: check.observed };
  const auctionWins = rank[auction.verdict] > rank[check.verdict];
  return {
    ...check,
    verdict: auctionWins ? auction.verdict : check.verdict,
    category: auctionWins ? auction.category : check.category,
    expected: { demand: check.expected, auction: auction.expected },
    observed: { ...observed, auction: auction.observed },
    evidenceIds: [...new Set([...check.evidenceIds, ...auction.evidenceIds])],
  };
}
