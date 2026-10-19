import { createHash } from "node:crypto";
import { parseEvidence, type Evidence, type JsonValue } from "../contracts.js";
import type { BackendLoggerRecord } from "../logger/backend-normalize.js";

const ID_TYPES = ["pageview", "player", "auction", "request"] as const;
const BACKEND_KEYS = ["pageviewId", "playerId", "auctionId", "requestId"] as const;
type IdType = (typeof ID_TYPES)[number];
type BackendKey = (typeof BACKEND_KEYS)[number];

export interface CorrelationPolicy {
  schemaVersion: 1;
  policyId: string;
  status: "draft" | "confirmed";
  displayClockSkewMs: number;
  mappings: Array<{ idType: IdType; browserDataKey: string; backendIdentifier: BackendKey }>;
}

export interface CorrelationJoin {
  state: "exact" | "ambiguous" | "unmatched";
  reason: "verified_unique_key" | "policy_unconfirmed" | "missing_browser_identifier" | "missing_backend_identifier" | "no_matching_identifier" | "repeated_identifier" | "conflicting_identifiers";
  browserEvidenceIds: string[];
  backendRecordIds: string[];
  matchedKeys: Array<{ idType: IdType; fingerprint: string }>;
}

export interface BackendCorrelationResult {
  policyId: string;
  backendStatus: "complete" | "incomplete" | "unavailable";
  joins: CorrelationJoin[];
  backendEvidence: Evidence[];
  coverage: {
    exact: number;
    ambiguous: number;
    unmatchedBrowser: number;
    unmatchedBackend: number;
    highConfidenceBackendRcaAllowed: boolean;
    limitation: string | null;
  };
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

export function parseCorrelationPolicy(value: unknown): CorrelationPolicy {
  const policy = object(value, "correlation policy");
  if (policy.schemaVersion !== 1) throw new TypeError("correlation policy.schemaVersion must be 1");
  const status = policy.status;
  if (status !== "draft" && status !== "confirmed") throw new TypeError("correlation policy.status must be draft or confirmed");
  if (typeof policy.displayClockSkewMs !== "number" || !Number.isFinite(policy.displayClockSkewMs)) throw new TypeError("correlation policy.displayClockSkewMs must be finite");
  if (!Array.isArray(policy.mappings) || policy.mappings.length === 0) throw new TypeError("correlation policy.mappings must not be empty");
  const mappings = policy.mappings.map((value, index) => {
    const item = object(value, `correlation policy.mappings[${index}]`);
    if (typeof item.idType !== "string" || !ID_TYPES.includes(item.idType as IdType)) throw new TypeError(`correlation policy.mappings[${index}].idType is invalid`);
    if (typeof item.backendIdentifier !== "string" || !BACKEND_KEYS.includes(item.backendIdentifier as BackendKey)) throw new TypeError(`correlation policy.mappings[${index}].backendIdentifier is invalid`);
    const browserDataKey = string(item.browserDataKey, `correlation policy.mappings[${index}].browserDataKey`);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(browserDataKey)) throw new TypeError(`correlation policy.mappings[${index}].browserDataKey must be a direct data key`);
    return { idType: item.idType as IdType, browserDataKey, backendIdentifier: item.backendIdentifier as BackendKey };
  });
  if (new Set(mappings.map((item) => item.idType)).size !== mappings.length) throw new TypeError("correlation policy mappings must not duplicate idType");
  if (new Set(mappings.map((item) => item.backendIdentifier)).size !== mappings.length) throw new TypeError("correlation policy mappings must not duplicate backendIdentifier");
  return {
    schemaVersion: 1,
    policyId: string(policy.policyId, "correlation policy.policyId"),
    status,
    displayClockSkewMs: policy.displayClockSkewMs,
    mappings,
  };
}

function identifier(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function browserIds(evidence: Evidence, policy: CorrelationPolicy): Map<IdType, string> {
  return new Map(policy.mappings.flatMap((mapping) => {
    const value = identifier(evidence.data[mapping.browserDataKey]);
    return value === null ? [] : [[mapping.idType, value] as const];
  }));
}

function backendIds(record: BackendLoggerRecord, policy: CorrelationPolicy): Map<IdType, string> {
  return new Map(policy.mappings.flatMap((mapping) => {
    const value = record.identifiers[mapping.backendIdentifier];
    return value === undefined ? [] : [[mapping.idType, value] as const];
  }));
}

function pair(left: Map<IdType, string>, right: Map<IdType, string>): { equal: IdType[]; conflicts: IdType[] } {
  const common = [...left.keys()].filter((key) => right.has(key));
  return {
    equal: common.filter((key) => left.get(key) === right.get(key)),
    conflicts: common.filter((key) => left.get(key) !== right.get(key)),
  };
}

function matchedKeys(types: readonly IdType[], ids: Map<IdType, string>): CorrelationJoin["matchedKeys"] {
  return types.map((idType) => ({ idType, fingerprint: fingerprint(ids.get(idType)!) }));
}

export function correlateBackendLogger(input: {
  policy: unknown;
  backendStatus: "complete" | "incomplete" | "unavailable";
  browserEvidence: readonly Evidence[];
  backendRecords: readonly BackendLoggerRecord[];
}): BackendCorrelationResult {
  const policy = parseCorrelationPolicy(input.policy);
  const browserEvidenceIds = input.browserEvidence.map((item) => item.evidenceId);
  const backendRecordIds = input.backendRecords.map((item) => item.recordId);
  if (new Set(browserEvidenceIds).size !== browserEvidenceIds.length) throw new TypeError("browser evidence IDs must be unique");
  if (new Set(backendRecordIds).size !== backendRecordIds.length) throw new TypeError("backend record IDs must be unique");
  if (input.browserEvidence.some((item) => item.source !== "browser_logger" && item.source !== "browser_network")) {
    throw new TypeError("browser evidence must come from browser_logger or browser_network");
  }
  const browser = input.browserEvidence.map((evidence) => ({ evidence, ids: browserIds(evidence, policy) }));
  const backend = input.backendRecords.map((record) => ({ record, ids: backendIds(record, policy) }));
  const joins: CorrelationJoin[] = [];
  const exactBackend = new Set<string>();
  const consideredBackend = new Set<string>();

  if (policy.status !== "confirmed") {
    for (const item of browser) joins.push({ state: "unmatched", reason: "policy_unconfirmed", browserEvidenceIds: [item.evidence.evidenceId], backendRecordIds: [], matchedKeys: [] });
    for (const item of backend) joins.push({ state: "unmatched", reason: "policy_unconfirmed", browserEvidenceIds: [], backendRecordIds: [item.record.recordId], matchedKeys: [] });
  } else {
    const candidates = browser.map((left) => backend.flatMap((right) => {
      const compared = pair(left.ids, right.ids);
      if (compared.equal.length === 0) return [];
      return [{ right, ...compared }];
    }));
    const reverseCounts = new Map<string, number>();
    for (const matches of candidates) for (const match of matches) reverseCounts.set(match.right.record.recordId, (reverseCounts.get(match.right.record.recordId) ?? 0) + 1);

    for (let index = 0; index < browser.length; index += 1) {
      const left = browser[index]!;
      const matches = candidates[index]!;
      for (const match of matches) consideredBackend.add(match.right.record.recordId);
      if (left.ids.size === 0) {
        joins.push({ state: "unmatched", reason: "missing_browser_identifier", browserEvidenceIds: [left.evidence.evidenceId], backendRecordIds: [], matchedKeys: [] });
      } else if (matches.length === 0) {
        joins.push({ state: "unmatched", reason: "no_matching_identifier", browserEvidenceIds: [left.evidence.evidenceId], backendRecordIds: [], matchedKeys: [] });
      } else {
        const only = matches[0];
        const unique = matches.length === 1 && only !== undefined && reverseCounts.get(only.right.record.recordId) === 1;
        if (unique && only.conflicts.length === 0) {
          exactBackend.add(only.right.record.recordId);
          joins.push({
            state: "exact", reason: "verified_unique_key", browserEvidenceIds: [left.evidence.evidenceId], backendRecordIds: [only.right.record.recordId],
            matchedKeys: matchedKeys(only.equal, left.ids),
          });
        } else {
          joins.push({
            state: "ambiguous",
            reason: matches.some((match) => match.conflicts.length > 0) ? "conflicting_identifiers" : "repeated_identifier",
            browserEvidenceIds: [left.evidence.evidenceId],
            backendRecordIds: matches.map((match) => match.right.record.recordId),
            matchedKeys: matchedKeys([...new Set(matches.flatMap((match) => match.equal))], left.ids),
          });
        }
      }
    }
    for (const item of backend) {
      if (exactBackend.has(item.record.recordId) || consideredBackend.has(item.record.recordId)) continue;
      joins.push({
        state: "unmatched", reason: item.ids.size === 0 ? "missing_backend_identifier" : "no_matching_identifier",
        browserEvidenceIds: [], backendRecordIds: [item.record.recordId], matchedKeys: [],
      });
    }
  }

  const exactJoins = joins.filter((join) => join.state === "exact");
  const evidenceById = new Map(input.browserEvidence.map((item) => [item.evidenceId, item]));
  const recordById = new Map(input.backendRecords.map((item) => [item.recordId, item]));
  const backendEvidence = exactJoins.map((join) => {
    const source = evidenceById.get(join.browserEvidenceIds[0]!)!;
    const record = recordById.get(join.backendRecordIds[0]!)!;
    const observedDeltaMs = Date.parse(record.receivedAt) - Date.parse(source.capturedAt);
    return parseEvidence({
      schemaVersion: 1,
      evidenceId: `backend:${record.recordId}`,
      runId: source.runId,
      articleEpochId: source.articleEpochId,
      deviceId: source.deviceId,
      source: "backend_logger",
      capturedAt: record.receivedAt,
      data: {
        backendRecordId: record.recordId,
        browserEvidenceId: source.evidenceId,
        fields: record.fields,
        correlation: { state: "exact", policyId: policy.policyId, matchedKeys: join.matchedKeys },
        timing: { observedDeltaMs, displayClockSkewMs: policy.displayClockSkewMs, displayAdjustedDeltaMs: observedDeltaMs - policy.displayClockSkewMs },
      },
    });
  });
  const ambiguous = joins.filter((join) => join.state === "ambiguous").length;
  const unmatchedBrowser = joins.filter((join) => join.state === "unmatched" && join.browserEvidenceIds.length > 0).length;
  const unmatchedBackend = joins.filter((join) => join.state === "unmatched" && join.backendRecordIds.length > 0).length;
  const allResolved = input.browserEvidence.length > 0 && input.backendRecords.length > 0 && exactJoins.length === input.browserEvidence.length
    && exactJoins.length === input.backendRecords.length && ambiguous === 0 && unmatchedBrowser === 0 && unmatchedBackend === 0;
  const highConfidence = policy.status === "confirmed" && input.backendStatus === "complete" && allResolved;
  return {
    policyId: policy.policyId,
    backendStatus: input.backendStatus,
    joins,
    backendEvidence,
    coverage: {
      exact: exactJoins.length,
      ambiguous,
      unmatchedBrowser,
      unmatchedBackend,
      highConfidenceBackendRcaAllowed: highConfidence,
      limitation: highConfidence ? null : policy.status !== "confirmed" ? "correlation policy is unconfirmed"
        : input.backendStatus !== "complete" ? `backend collection is ${input.backendStatus}` : "one or more browser/backend identities are unresolved",
    },
  };
}
