import { assertDeploymentAcceptance, parseDeploymentAcceptance, type DeploymentAcceptance } from "../deploy/acceptance.js";

const REQUIRED_DECISIONS = Array.from({ length: 14 }, (_, index) => `D${String(index + 1).padStart(2, "0")}`);

interface EvidenceReference {
  evidenceId: string;
  sha256: string;
}

interface DeviceEvidence {
  deviceId: string;
  deviceClass: "desktop" | "mobile";
  platform: string;
  realDevice: boolean;
  evidence: EvidenceReference[];
}

export interface PilotReadiness {
  schemaVersion: 1;
  corpus: {
    corpusId: string;
    labelSetId: string;
    labelOwner: string;
    evidence: EvidenceReference[];
  };
  decisions: Array<{
    decisionId: string;
    confirmedBy: string;
    evidence: EvidenceReference[];
  }>;
  deployment: {
    acceptance: DeploymentAcceptance;
    browserImageDigest: string;
    profileHashes: string[];
    requiredOrigins: string[];
  };
  devices: DeviceEvidence[];
  execution: {
    declaredConcurrency: number;
    costSourceId: string;
    evidence: EvidenceReference[];
  };
}

export interface PilotReadinessEvaluation {
  ready: boolean;
  corpusId: string;
  labelSetId: string;
  labelOwner: string;
  deploymentAcceptanceId: string;
  declaredConcurrency: number;
  costSourceId: string;
  gates: {
    labeledCorpusEvidencePresent: boolean;
    allRuleDecisionsConfirmed: boolean;
    deploymentAcceptanceValid: boolean;
    approvedProfilesCovered: boolean;
    realMobileEvidencePresent: boolean;
    realIosEvidencePresent: boolean;
    executionAndCostEvidencePresent: boolean;
  };
  failures: string[];
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function digest(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^sha256:[a-f0-9]{64}$/.test(result)) throw new TypeError(`${path} must be a lowercase SHA-256 digest`);
  return result;
}

function evidence(value: unknown, path: string): EvidenceReference[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${path} must be a non-empty array`);
  const result = value.map((entry, index) => {
    const item = object(entry, `${path}[${index}]`);
    return { evidenceId: text(item.evidenceId, `${path}[${index}].evidenceId`), sha256: digest(item.sha256, `${path}[${index}].sha256`) };
  });
  if (new Set(result.map((item) => item.evidenceId)).size !== result.length) throw new TypeError(`${path} must not contain duplicate evidence IDs`);
  return result;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${path} must be a non-empty array`);
  const result = value.map((item, index) => text(item, `${path}[${index}]`));
  if (new Set(result).size !== result.length) throw new TypeError(`${path} must not contain duplicates`);
  return result;
}

function parseReadiness(value: unknown): PilotReadiness {
  const input = object(value, "pilot readiness");
  if (input.schemaVersion !== 1) throw new TypeError("pilot readiness.schemaVersion must be 1");
  const corpus = object(input.corpus, "pilot readiness.corpus");
  if (!Array.isArray(input.decisions)) throw new TypeError("pilot readiness.decisions must be an array");
  const decisions = input.decisions.map((entry, index) => {
    const item = object(entry, `pilot readiness.decisions[${index}]`);
    return {
      decisionId: text(item.decisionId, `pilot readiness.decisions[${index}].decisionId`),
      confirmedBy: text(item.confirmedBy, `pilot readiness.decisions[${index}].confirmedBy`),
      evidence: evidence(item.evidence, `pilot readiness.decisions[${index}].evidence`),
    };
  });
  if (new Set(decisions.map((item) => item.decisionId)).size !== decisions.length) throw new TypeError("pilot readiness decisions must not contain duplicates");

  const deployment = object(input.deployment, "pilot readiness.deployment");
  const browserImageDigest = digest(deployment.browserImageDigest, "pilot readiness.deployment.browserImageDigest");
  const profileHashes = strings(deployment.profileHashes, "pilot readiness.deployment.profileHashes")
    .map((item, index) => digest(item, `pilot readiness.deployment.profileHashes[${index}]`));
  const requiredOrigins = strings(deployment.requiredOrigins, "pilot readiness.deployment.requiredOrigins");
  for (const [index, value] of requiredOrigins.entries()) {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.origin !== value) throw new TypeError(`pilot readiness.deployment.requiredOrigins[${index}] must be an HTTPS origin`);
  }
  const acceptance = parseDeploymentAcceptance(deployment.acceptance);

  if (!Array.isArray(input.devices) || input.devices.length === 0) throw new TypeError("pilot readiness.devices must be a non-empty array");
  const devices = input.devices.map((entry, index): DeviceEvidence => {
    const item = object(entry, `pilot readiness.devices[${index}]`);
    if (item.deviceClass !== "desktop" && item.deviceClass !== "mobile") throw new TypeError(`pilot readiness.devices[${index}].deviceClass must be desktop or mobile`);
    if (typeof item.realDevice !== "boolean") throw new TypeError(`pilot readiness.devices[${index}].realDevice must be a boolean`);
    return {
      deviceId: text(item.deviceId, `pilot readiness.devices[${index}].deviceId`),
      deviceClass: item.deviceClass,
      platform: text(item.platform, `pilot readiness.devices[${index}].platform`),
      realDevice: item.realDevice,
      evidence: evidence(item.evidence, `pilot readiness.devices[${index}].evidence`),
    };
  });
  if (new Set(devices.map((item) => item.deviceId)).size !== devices.length) throw new TypeError("pilot readiness devices must not contain duplicate device IDs");

  const execution = object(input.execution, "pilot readiness.execution");
  if (typeof execution.declaredConcurrency !== "number" || !Number.isInteger(execution.declaredConcurrency) || execution.declaredConcurrency < 1) {
    throw new TypeError("pilot readiness.execution.declaredConcurrency must be an integer >= 1");
  }
  return {
    schemaVersion: 1,
    corpus: {
      corpusId: text(corpus.corpusId, "pilot readiness.corpus.corpusId"),
      labelSetId: text(corpus.labelSetId, "pilot readiness.corpus.labelSetId"),
      labelOwner: text(corpus.labelOwner, "pilot readiness.corpus.labelOwner"),
      evidence: evidence(corpus.evidence, "pilot readiness.corpus.evidence"),
    },
    decisions,
    deployment: { acceptance, browserImageDigest, profileHashes, requiredOrigins },
    devices,
    execution: {
      declaredConcurrency: execution.declaredConcurrency,
      costSourceId: text(execution.costSourceId, "pilot readiness.execution.costSourceId"),
      evidence: evidence(execution.evidence, "pilot readiness.execution.evidence"),
    },
  };
}

export function evaluatePilotReadiness(value: unknown, now = new Date()): PilotReadinessEvaluation {
  const readiness = parseReadiness(value);
  let deploymentAcceptanceValid = true;
  try {
    for (const profileHash of readiness.deployment.profileHashes) {
      assertDeploymentAcceptance({
        acceptance: readiness.deployment.acceptance,
        browserImageDigest: readiness.deployment.browserImageDigest,
        profileHash,
        requiredOrigins: readiness.deployment.requiredOrigins,
        now,
      });
    }
  } catch {
    deploymentAcceptanceValid = false;
  }
  const confirmed = new Set(readiness.decisions.map((item) => item.decisionId));
  const gates = {
    labeledCorpusEvidencePresent: readiness.corpus.evidence.length > 0,
    allRuleDecisionsConfirmed: REQUIRED_DECISIONS.every((decision) => confirmed.has(decision)) && confirmed.size === REQUIRED_DECISIONS.length,
    deploymentAcceptanceValid,
    approvedProfilesCovered: readiness.deployment.profileHashes.every((hash) => readiness.deployment.acceptance.approvedProfileHashes.includes(hash)),
    realMobileEvidencePresent: readiness.devices.some((device) => device.deviceClass === "mobile" && device.realDevice),
    realIosEvidencePresent: readiness.devices.some((device) => device.deviceClass === "mobile" && device.realDevice && device.platform.toLowerCase() === "ios"),
    executionAndCostEvidencePresent: readiness.execution.evidence.length > 0,
  };
  const labels: Record<keyof typeof gates, string> = {
    labeledCorpusEvidencePresent: "QA-labeled corpus evidence is missing",
    allRuleDecisionsConfirmed: "D01 through D14 are not all confirmed with evidence",
    deploymentAcceptanceValid: "Task 20 deployment acceptance is invalid, expired or does not cover the running deployment",
    approvedProfilesCovered: "one or more pilot profile hashes are absent from deployment acceptance",
    realMobileEvidencePresent: "real mobile-device evidence is missing",
    realIosEvidencePresent: "real iOS-device evidence is missing",
    executionAndCostEvidencePresent: "declared concurrency and measured cost source lack evidence",
  };
  const failures = (Object.entries(gates) as Array<[keyof typeof gates, boolean]>).filter(([, passed]) => !passed).map(([gate]) => labels[gate]);
  return {
    ready: failures.length === 0,
    corpusId: readiness.corpus.corpusId,
    labelSetId: readiness.corpus.labelSetId,
    labelOwner: readiness.corpus.labelOwner,
    deploymentAcceptanceId: readiness.deployment.acceptance.acceptanceId,
    declaredConcurrency: readiness.execution.declaredConcurrency,
    costSourceId: readiness.execution.costSourceId,
    gates,
    failures,
  };
}
