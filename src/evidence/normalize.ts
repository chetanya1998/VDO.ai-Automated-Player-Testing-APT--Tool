import { parseEvidence, type ArticleEpoch, type Evidence, type JsonValue, type Run } from "../contracts.js";
import type { BrowserCaptureResult, CapturedBrowserEvidence, CollectionGap } from "../browser/capture.js";
import {
  parseBrowserLoggerPayload,
  summarizePhysicalLoadPayloads,
  type EventAliasProfile,
  type LoggerPayloadDiagnostic,
  type ParsedBrowserLoggerPayload,
} from "../logger/browser-payload.js";
import { snapshotProfile, type ProfileSnapshot } from "../profile.js";

export interface CoverageError {
  code: "capture_gap" | "logger_payload" | "unsupported_capability" | "article_scope_fallback" | "profile_mismatch";
  severity: "warning" | "failure" | "unknown" | "information";
  evidenceId: string | null;
  detail: string;
}

export interface NormalizedEvidenceBundle {
  run: Run;
  profileSnapshot: ProfileSnapshot;
  evidence: Evidence[];
  loggerTimelineEvidenceIds: string[];
  coverageErrors: CoverageError[];
}

export interface NormalizeEvidenceInput {
  run: Run;
  capture: BrowserCaptureResult;
  articleEpochs: readonly ArticleEpoch[];
  profile: unknown;
  eventAliases: EventAliasProfile;
  physicalLoadId: string;
}

interface ExpandedCapture {
  item: CapturedBrowserEvidence;
  evidenceId: string;
  data: { [key: string]: JsonValue };
  playerKey: string | null;
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function captureUrl(data: { [key: string]: JsonValue }): string | null {
  return stringValue(data.requestStartPageUrl) ?? stringValue(data.pageUrl);
}

function epochAt(epochs: readonly ArticleEpoch[], capturedAt: string): ArticleEpoch | undefined {
  const time = Date.parse(capturedAt);
  return epochs.find((epoch) => Date.parse(epoch.startedAt) <= time && (epoch.endedAt === undefined || time <= Date.parse(epoch.endedAt)));
}

function resolveEpoch(item: CapturedBrowserEvidence, data: { [key: string]: JsonValue }, epochs: readonly ArticleEpoch[]): {
  epoch: ArticleEpoch;
  fallback: boolean;
} {
  if (epochs.length === 0) throw new TypeError("normalization requires at least one article epoch");
  const url = captureUrl(data);
  const exact = url === null ? undefined : epochs.find((epoch) => epoch.url === url && epochAt([epoch], item.capturedAt) !== undefined);
  if (exact !== undefined) return { epoch: exact, fallback: false };
  const timed = epochAt(epochs, item.capturedAt);
  return { epoch: timed ?? epochs[0]!, fallback: true };
}

function expand(item: CapturedBrowserEvidence): ExpandedCapture[] {
  const players = item.source === "browser_dom" && Array.isArray(item.data.players) ? item.data.players : [];
  if (players.length === 0) {
    const fields = item.source === "browser_logger" && typeof item.data.fields === "object" && item.data.fields !== null && !Array.isArray(item.data.fields)
      ? item.data.fields as { [key: string]: JsonValue }
      : {};
    const tagName = stringValue(fields.tagName);
    return [{ item, evidenceId: item.evidenceId, data: item.data, playerKey: tagName === null ? null : `tag:${tagName}` }];
  }
  return players.map((player, index) => {
    const record = typeof player === "object" && player !== null && !Array.isArray(player) ? player as { [key: string]: JsonValue } : {};
    const id = stringValue(record.id) ?? "anonymous";
    return {
      item,
      evidenceId: `${item.evidenceId}:player:${index + 1}`,
      data: { ...item.data, players: [], player: record },
      playerKey: `dom:${id}:${index + 1}`,
    };
  });
}

function loggerPayload(item: CapturedBrowserEvidence, aliases: EventAliasProfile): ParsedBrowserLoggerPayload | null {
  if (item.source !== "browser_logger") return null;
  if (item.data.parseState === "malformed" || item.data.parseState === "empty") {
    return parseBrowserLoggerPayload(null, "application/json", aliases);
  }
  const fields = typeof item.data.fields === "object" && item.data.fields !== null && !Array.isArray(item.data.fields) ? item.data.fields : {};
  return parseBrowserLoggerPayload(JSON.stringify(fields), "application/json", aliases);
}

function diagnosticError(diagnostic: LoggerPayloadDiagnostic, evidenceId: string | null): CoverageError {
  return {
    code: "logger_payload",
    severity: diagnostic.severity,
    evidenceId,
    detail: diagnostic.detail,
  };
}

function gapError(gap: CollectionGap): CoverageError {
  return { code: "capture_gap", severity: "unknown", evidenceId: gap.evidenceId, detail: `${gap.code}: ${gap.detail}` };
}

export function normalizeEvidence(input: NormalizeEvidenceInput): NormalizedEvidenceBundle {
  const profileSnapshot = snapshotProfile(input.profile);
  const coverageErrors: CoverageError[] = input.capture.gaps.map(gapError);
  if (profileSnapshot.profileId !== input.run.profileId) coverageErrors.push({
    code: "profile_mismatch",
    severity: "failure",
    evidenceId: null,
    detail: `Run profile ${input.run.profileId} does not match snapshot ${profileSnapshot.profileId}.`,
  });
  for (const [name, capability] of Object.entries(input.run.capabilities)) {
    if (capability.state === "unavailable") coverageErrors.push({
      code: "unsupported_capability",
      severity: "unknown",
      evidenceId: null,
      detail: `${name} is unavailable: ${capability.reason ?? "no reason supplied"}`,
    });
  }

  const networkById = new Map(input.capture.evidence.filter((item) => item.source === "browser_network").map((item) => [item.evidenceId, item]));
  const parsedLoggers = new Map<string, ParsedBrowserLoggerPayload>();
  for (const item of input.capture.evidence) {
    const payload = loggerPayload(item, input.eventAliases);
    if (payload === null) continue;
    parsedLoggers.set(item.evidenceId, payload);
    coverageErrors.push(...payload.diagnostics.map((diagnostic) => diagnosticError(diagnostic, item.evidenceId)));
  }
  const loadSummary = summarizePhysicalLoadPayloads([...parsedLoggers.values()]);
  coverageErrors.push(...loadSummary.diagnostics.map((diagnostic) => diagnosticError(diagnostic, null)));

  const evidence: Evidence[] = [];
  for (const expanded of input.capture.evidence.flatMap(expand)) {
    const { item } = expanded;
    const { epoch, fallback } = resolveEpoch(item, expanded.data, input.articleEpochs);
    if (fallback) coverageErrors.push({
      code: "article_scope_fallback",
      severity: "unknown",
      evidenceId: expanded.evidenceId,
      detail: "No exact request-start/displayed URL article match; assigned the active or first article epoch.",
    });
    const parsedLogger = parsedLoggers.get(item.evidenceId);
    const networkId = item.source === "browser_logger" ? stringValue(item.data.networkEvidenceId) : null;
    const network = networkId === null ? undefined : networkById.get(networkId);
    const eventTime = network?.capturedAt ?? item.capturedAt;
    const normalizedData: { [key: string]: JsonValue } = {
      ...expanded.data,
      rawArtifactRef: item.evidenceId,
      observationTime: item.capturedAt,
      eventTime,
      physicalLoadId: input.physicalLoadId,
      sessionId: null,
      playerKey: expanded.playerKey,
      articleUrl: epoch.url,
      displayedUrlAtRequestStart: captureUrl(expanded.data),
      profileHash: profileSnapshot.profileHash,
    };
    if (parsedLogger !== undefined) {
      normalizedData.rawEvent = parsedLogger.rawEvent;
      normalizedData.canonicalEvent = parsedLogger.canonicalEvent;
      normalizedData.payloadDiagnostics = parsedLogger.diagnostics.map((diagnostic) => ({ code: diagnostic.code, severity: diagnostic.severity, field: diagnostic.field }));
      normalizedData.requestStartedMs = network?.data.startedMs ?? null;
    }
    evidence.push(parseEvidence({
      schemaVersion: 1,
      evidenceId: expanded.evidenceId,
      runId: input.run.runId,
      articleEpochId: epoch.articleEpochId,
      deviceId: input.run.deviceId,
      source: item.source,
      capturedAt: item.capturedAt,
      data: normalizedData,
    }));
  }

  const loggerTimelineEvidenceIds = evidence
    .filter((item) => item.source === "browser_logger")
    .sort((left, right) => Number(left.data.requestStartedMs ?? Number.MAX_SAFE_INTEGER) - Number(right.data.requestStartedMs ?? Number.MAX_SAFE_INTEGER)
      || left.evidenceId.localeCompare(right.evidenceId))
    .map((item) => item.evidenceId);

  return { run: input.run, profileSnapshot, evidence, loggerTimelineEvidenceIds, coverageErrors };
}
