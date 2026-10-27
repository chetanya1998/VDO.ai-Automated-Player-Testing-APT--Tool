import type { CheckResult, Evidence, JsonValue, Verdict } from "../contracts.js";
import { isTagAnchorId } from "./integration.js";

export type BlockExpectation = "expected" | "unexpected" | "unknown";
export type BlockEvent = "blocked_player" | "blocked_inline" | "blocked_autoplay" | "blocked_ima" | "blocked_agent" | "blocked_device" | "blocked_url" | "error";

export interface RuntimePolicy {
  schemaVersion: number;
  policyId: string;
  profileId: string;
  status: "draft" | "confirmed";
  blocks: Record<BlockEvent, { expectation: BlockExpectation; byDevice: Record<string, BlockExpectation> }>;
  forceplayFailureAttempts: number;
  errorCodes: Record<string, { meaning: "missing_anchor" | null }>;
  // pathPatterns: case-insensitive regular expressions for versioned file names such as vdo.player.8.0.js.
  dependencies: Array<{ id: string; products: string[]; required: boolean; pathSuffixes: string[]; pathPatterns?: string[] }>;
}

export interface BlockedValidationInput {
  evidence: readonly Evidence[];
  policy: RuntimePolicy;
  profileId: string;
  product: string;
  deviceId: string;
  articleEpochId: string;
  tagName: string;
  captureComplete: boolean;
}

export interface BlockClassification {
  event: BlockEvent;
  rawEvent: string;
  evidenceId: string;
  expectation: BlockExpectation;
  verdict: Verdict;
  category: CheckResult["category"];
  placement: "inside" | "outside" | "unknown";
  errorCode: string | null;
  meaning: string | null;
  cause: string;
  forceplayAttemptsObserved: number;
  recoveredAfterBlock: boolean;
}

export interface BlockedValidation {
  check: CheckResult;
  classifications: BlockClassification[];
}

const BLOCK_EVENTS: BlockEvent[] = ["blocked_player", "blocked_inline", "blocked_autoplay", "blocked_ima", "blocked_agent", "blocked_device", "blocked_url", "error"];
const VERDICT_RANK: Record<Verdict, number> = { PASS: 0, NOT_APPLICABLE: 0, UNKNOWN: 1, WARNING: 2, FAIL: 3 };

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function expectation(value: unknown, path: string): BlockExpectation {
  if (value !== "expected" && value !== "unexpected" && value !== "unknown") throw new TypeError(`${path} must be expected, unexpected, or unknown`);
  return value;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${path} must be a non-empty array`);
  return value.map((item, index) => text(item, `${path}[${index}]`));
}

export function parseRuntimePolicy(value: unknown): RuntimePolicy {
  const root = object(value, "runtimePolicy");
  if (!Number.isInteger(root.schemaVersion) || Number(root.schemaVersion) < 1) throw new TypeError("runtimePolicy.schemaVersion must be a positive integer");
  const policyId = text(root.policyId, "runtimePolicy.policyId");
  const profileId = text(root.profileId, "runtimePolicy.profileId");
  if (root.status !== "draft" && root.status !== "confirmed") throw new TypeError("runtimePolicy.status must be draft or confirmed");
  const blocksInput = object(root.blocks, "runtimePolicy.blocks");
  const blocks = Object.fromEntries(BLOCK_EVENTS.map((name) => {
    const rule = object(blocksInput[name], `runtimePolicy.blocks.${name}`);
    const deviceInput = rule.byDevice === undefined ? {} : object(rule.byDevice, `runtimePolicy.blocks.${name}.byDevice`);
    return [name, {
      expectation: expectation(rule.expectation, `runtimePolicy.blocks.${name}.expectation`),
      byDevice: Object.fromEntries(Object.entries(deviceInput).map(([device, state]) => [device, expectation(state, `runtimePolicy.blocks.${name}.byDevice.${device}`)])),
    }];
  })) as RuntimePolicy["blocks"];
  if (!Number.isInteger(root.forceplayFailureAttempts) || Number(root.forceplayFailureAttempts) < 1) throw new TypeError("runtimePolicy.forceplayFailureAttempts must be a positive integer");
  const codesInput = object(root.errorCodes, "runtimePolicy.errorCodes");
  const errorCodes = Object.fromEntries(Object.entries(codesInput).map(([code, value]) => {
    const entry = object(value, `runtimePolicy.errorCodes.${code}`);
    if (entry.meaning !== null && entry.meaning !== "missing_anchor") throw new TypeError(`runtimePolicy.errorCodes.${code}.meaning is unsupported`);
    return [code, { meaning: entry.meaning as "missing_anchor" | null }];
  }));
  if (!Array.isArray(root.dependencies)) throw new TypeError("runtimePolicy.dependencies must be an array");
  const dependencies = root.dependencies.map((value, index) => {
    const entry = object(value, `runtimePolicy.dependencies[${index}]`);
    if (typeof entry.required !== "boolean") throw new TypeError(`runtimePolicy.dependencies[${index}].required must be boolean`);
    return {
      id: text(entry.id, `runtimePolicy.dependencies[${index}].id`),
      products: strings(entry.products, `runtimePolicy.dependencies[${index}].products`),
      required: entry.required,
      pathSuffixes: strings(entry.pathSuffixes, `runtimePolicy.dependencies[${index}].pathSuffixes`),
      ...(entry.pathPatterns === undefined ? {} : { pathPatterns: strings(entry.pathPatterns, `runtimePolicy.dependencies[${index}].pathPatterns`).map((pattern, patternIndex) => {
        try { new RegExp(pattern, "i"); } catch { throw new TypeError(`runtimePolicy.dependencies[${index}].pathPatterns[${patternIndex}] is not a valid pattern`); }
        return pattern;
      }) }),
    };
  });
  const ids = dependencies.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new TypeError("runtimePolicy dependency ids must be unique");
  return { schemaVersion: Number(root.schemaVersion), policyId, profileId, status: root.status, blocks, forceplayFailureAttempts: Number(root.forceplayFailureAttempts), errorCodes, dependencies };
}

function canonical(item: Evidence): string | null {
  return typeof item.data.canonicalEvent === "string" ? item.data.canonicalEvent : null;
}

function started(item: Evidence): number | null {
  return typeof item.data.requestStartedMs === "number" ? item.data.requestStartedMs : null;
}

function field(item: Evidence, name: string): string | null {
  const fields = item.data.fields;
  return typeof fields === "object" && fields !== null && !Array.isArray(fields) && typeof fields[name] === "string" ? fields[name] : null;
}

function eventCode(item: Evidence): string | null {
  if (typeof item.data.errorCode === "string" && item.data.errorCode !== "") return item.data.errorCode;
  const raw = typeof item.data.rawEvent === "string" ? item.data.rawEvent : "";
  return /^error(?:\s*[:\-]\s*|\s+)([A-Za-z0-9_]+)$/i.exec(raw)?.[1] ?? null;
}

function placement(event: Evidence, timeline: readonly Evidence[]): "inside" | "outside" | "unknown" {
  const eventTime = started(event);
  if (eventTime === null) return "unknown";
  const name = canonical(event);
  const tag = field(event, "tagName");
  const related = timeline.filter((item) => tag === null || field(item, "tagName") === tag);
  const afterName = name === "blocked_url" ? "loaded" : "init_vdo";
  const beforeName = name === "blocked_url" ? "init_vdo" : "pageview";
  const after = related.filter((item) => canonical(item) === afterName && started(item) !== null && started(item)! < eventTime).at(-1);
  const before = related.find((item) => canonical(item) === beforeName && started(item) !== null && started(item)! > eventTime);
  if (after !== undefined && before !== undefined) return "inside";
  if (related.some((item) => canonical(item) === afterName && started(item) !== null && started(item)! >= eventTime)
    || related.some((item) => canonical(item) === beforeName && started(item) !== null && started(item)! <= eventTime)) return "outside";
  return "unknown";
}

function anchorMissing(evidence: readonly Evidence[], tagName: string): boolean | null {
  const dom = evidence.filter((item) => item.source === "browser_dom");
  if (dom.length === 0) return null;
  const anchors = dom.flatMap((item) => Array.isArray(item.data.anchors) ? item.data.anchors : []);
  return !anchors.some((value) => typeof value === "object" && value !== null && !Array.isArray(value) && isTagAnchorId(typeof value.id === "string" ? value.id : null, tagName));
}

function worst(classifications: readonly BlockClassification[]): Verdict {
  return classifications.reduce<Verdict>((current, item) => VERDICT_RANK[item.verdict] > VERDICT_RANK[current] ? item.verdict : current, "PASS");
}

export function validateBlockedEvents(input: BlockedValidationInput): BlockedValidation {
  const policy = parseRuntimePolicy(input.policy);
  if (policy.profileId !== input.profileId) throw new TypeError("runtime policy profile does not match the selected profile");
  const scoped = input.evidence.filter((item) => item.deviceId === input.deviceId && item.articleEpochId === input.articleEpochId);
  const timeline = scoped.filter((item) => item.source === "browser_logger").sort((a, b) => (started(a) ?? Number.MAX_SAFE_INTEGER) - (started(b) ?? Number.MAX_SAFE_INTEGER));
  const blocks = timeline.filter((item) => BLOCK_EVENTS.includes(canonical(item) as BlockEvent));
  const classifications = blocks.map((item): BlockClassification => {
    const event = canonical(item) as BlockEvent;
    const rawEvent = typeof item.data.rawEvent === "string" ? item.data.rawEvent : event;
    const configured = policy.blocks[event];
    const expected = configured.byDevice[input.deviceId] ?? configured.expectation;
    const code = event === "error" ? eventCode(item) : null;
    const codePolicy = code === null ? undefined : policy.errorCodes[code];
    const missingAnchor = codePolicy?.meaning === "missing_anchor" ? anchorMissing(scoped, field(item, "tagName") ?? input.tagName) : null;
    const forceplayAttempts = timeline.filter((candidate) => canonical(candidate) === "forceplay" && (started(candidate) ?? Infinity) < (started(item) ?? -Infinity)).length;
    const recovered = ["video_start", "auto_plays"].some((name) => timeline.some((candidate) => canonical(candidate) === name && (started(candidate) ?? -Infinity) > (started(item) ?? Infinity)));
    let verdict: Verdict = policy.status !== "confirmed" || expected === "unknown" ? "UNKNOWN" : expected === "expected" ? "WARNING" : "FAIL";
    let category: CheckResult["category"] = verdict === "FAIL" ? "RUNTIME_BROWSER" : "TOOLING";
    let cause = expected === "expected" ? "configured_block" : expected === "unexpected" ? "runtime_block" : "unconfirmed_block_policy";
    if (event === "blocked_agent") {
      verdict = "WARNING";
      category = "RUNTIME_BROWSER";
      cause = "bot_or_automation_signal";
    }
    if (event === "blocked_device") {
      cause = expected === "expected" ? "device_configuration" : expected === "unexpected" ? "unexpected_device_block" : "unconfirmed_device_policy";
      category = verdict === "UNKNOWN" ? "TOOLING" : "CONFIGURATION";
    }
    if (event === "error" && code !== null && (codePolicy === undefined || codePolicy.meaning === null)) {
      verdict = "UNKNOWN";
      category = "TOOLING";
      cause = "unknown_error_code";
    }
    if (event === "error" && codePolicy?.meaning === "missing_anchor") {
      verdict = missingAnchor === true ? "FAIL" : "UNKNOWN";
      category = missingAnchor === true ? "IMPLEMENTATION" : "TOOLING";
      cause = missingAnchor === true ? "missing_anchor" : "anchor_state_unconfirmed";
    }
    // Tech Doc: Blocked URL fires between loaded and initVdo, the others between initVdo and Pageview.
    const position = placement(item, timeline);
    if (position === "outside" && policy.status === "confirmed" && VERDICT_RANK[verdict] < VERDICT_RANK.WARNING) {
      verdict = "WARNING";
      category = "RUNTIME_BROWSER";
    }
    if (position === "outside") cause = `${cause}_outside_documented_window`;
    return {
      event, rawEvent, evidenceId: item.evidenceId, expectation: expected, verdict, category,
      placement: position, errorCode: code, meaning: codePolicy?.meaning ?? null, cause,
      forceplayAttemptsObserved: forceplayAttempts, recoveredAfterBlock: recovered,
    };
  });
  const hasUnknownAlias = timeline.some((item) => canonical(item) === null);
  const verdict = classifications.length > 0 ? worst(classifications)
    : policy.status !== "confirmed" || !input.captureComplete || hasUnknownAlias ? "UNKNOWN" : "PASS";
  const failing = classifications.find((item) => item.verdict === "FAIL");
  const category = failing?.category ?? (verdict === "PASS" ? "NONE" : verdict === "WARNING" ? "RUNTIME_BROWSER" : "TOOLING");
  return {
    classifications,
    check: {
      testCaseId: "TC-11",
      verdict,
      category,
      scope: { deviceId: input.deviceId, articleEpochId: input.articleEpochId, tagName: input.tagName },
      expected: { policyId: policy.policyId, state: policy.status, blocks: policy.blocks, windows: { blockedUrl: ["loaded", "init_vdo"], others: ["init_vdo", "pageview"] }, forceplayFailureAttempts: policy.forceplayFailureAttempts },
      observed: { product: input.product, blocks: classifications as unknown as JsonValue, unknownAliasObserved: hasUnknownAlias },
      evidenceIds: [...new Set(classifications.map((item) => item.evidenceId))],
    },
  };
}

export function applyRuntimeContext(checks: readonly CheckResult[], blocked: BlockedValidation, dependencyCheck: CheckResult): CheckResult[] {
  const relevantExpectedBlock = blocked.classifications.some((item) => ["blocked_player", "blocked_autoplay", "blocked_ima", "blocked_device", "blocked_url"].includes(item.event) && item.expectation === "expected");
  const relevantUnexpectedBlock = blocked.classifications.some((item) => ["blocked_player", "blocked_autoplay", "blocked_ima", "blocked_device", "blocked_url"].includes(item.event) && item.expectation === "unexpected");
  return checks.map((check) => {
    const observed = typeof check.observed === "object" && check.observed !== null && !Array.isArray(check.observed) ? check.observed : { value: check.observed };
    if (check.testCaseId === "TC-6" && JSON.stringify(check.observed).includes("missing init_vdo") && dependencyCheck.verdict === "FAIL") return {
      ...check,
      category: dependencyCheck.category,
      observed: { ...observed, dependencyContext: "required_dependency_failed_before_initVdo; placement attribution withheld", dependencyEvidenceIds: dependencyCheck.evidenceIds },
      evidenceIds: [...new Set([...check.evidenceIds, ...dependencyCheck.evidenceIds])],
    };
    if (check.testCaseId === "TC-9" && relevantExpectedBlock && !relevantUnexpectedBlock) return {
      ...check,
      verdict: "NOT_APPLICABLE",
      category: "NONE",
      observed: { ...observed, blockContext: "confirmed expected policy block changed ad-request applicability", blockEvidenceIds: blocked.check.evidenceIds },
      evidenceIds: [...new Set([...check.evidenceIds, ...blocked.check.evidenceIds])],
    };
    return check;
  });
}
