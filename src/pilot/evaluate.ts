import { VERDICTS, type Verdict } from "../contracts.js";

const CASE_IDS = Array.from({ length: 23 }, (_, index) => `TC-${index + 1}`);
const DEVICE_CLASSES = ["desktop", "mobile"] as const;
const SCENARIO_KINDS = ["healthy", "fault_or_boundary", "ambiguous"] as const;

type DeviceClass = (typeof DEVICE_CLASSES)[number];
type ScenarioKind = (typeof SCENARIO_KINDS)[number];

interface PilotRecord {
  scenarioId: string;
  testCaseId: string;
  deviceId: string;
  deviceClass: DeviceClass;
  scenarioKind: ScenarioKind;
  criticalFault: boolean;
  submittedAt: string;
  reportedAt: string;
  expectedVerdict: Verdict;
  actualVerdict: Verdict;
  evidenceIds: string[];
  expectedDiagnosisCode: string | null;
  actualDiagnosisCode: string | null;
  diagnosisEvidenceIds: string[];
  ambiguousJoinCount: number;
  articleTransitions: number;
  costUsd: number | null;
}

export interface PilotEvaluation {
  corpus: {
    records: number;
    distinctScenarios: number;
    declaredConcurrency: number;
    completeCaseDeviceKinds: number;
    requiredCaseDeviceKinds: number;
  };
  metrics: {
    submissionToReportP50Ms: number | null;
    submissionToReportP95Ms: number | null;
    diagnosisCompleteness: number | null;
    falsePositiveRate: number | null;
    recall: number | null;
    precision: number | null;
    ambiguousJoinCount: number;
    evidenceAccessDefects: number;
    measuredCostUsd: number | null;
    costCoverage: number;
  };
  gates: {
    noHealthyFalseFailures: boolean;
    seededCriticalFaultsDetected: boolean;
    ambiguousEvidenceRemainsUnknown: boolean;
    evidenceAndDiagnosisReferencesPresent: boolean;
    expectedDiagnosesComplete: boolean;
    caseDeviceScenarioCoverageComplete: boolean;
    threeArticleTransitionsComplete: boolean;
    decisionsConfirmed: boolean;
    accessRedactionAndEgressPassed: boolean;
    latencyP95Within300Seconds: boolean;
    costMeasured: boolean;
  };
  releaseReady: boolean;
  failures: string[];
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be a boolean`);
  return value;
}

function number(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) throw new TypeError(`${path} must be a finite number >= ${minimum}`);
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  const parsed = number(value, path, minimum);
  if (!Number.isInteger(parsed)) throw new TypeError(`${path} must be an integer`);
  return parsed;
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new TypeError(`${path} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((item, index) => string(item, `${path}[${index}]`));
}

function instant(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!Number.isFinite(Date.parse(parsed))) throw new TypeError(`${path} must be an ISO timestamp`);
  return parsed;
}

function parseRecord(value: unknown, index: number): PilotRecord {
  const item = object(value, `records[${index}]`);
  const testCaseId = enumeration(item.testCaseId, CASE_IDS, `records[${index}].testCaseId`);
  const submittedAt = instant(item.submittedAt, `records[${index}].submittedAt`);
  const reportedAt = instant(item.reportedAt, `records[${index}].reportedAt`);
  if (Date.parse(reportedAt) < Date.parse(submittedAt)) throw new TypeError(`records[${index}].reportedAt must not precede submittedAt`);
  const parsed: PilotRecord = {
    scenarioId: string(item.scenarioId, `records[${index}].scenarioId`),
    testCaseId,
    deviceId: string(item.deviceId, `records[${index}].deviceId`),
    deviceClass: enumeration(item.deviceClass, DEVICE_CLASSES, `records[${index}].deviceClass`),
    scenarioKind: enumeration(item.scenarioKind, SCENARIO_KINDS, `records[${index}].scenarioKind`),
    criticalFault: boolean(item.criticalFault, `records[${index}].criticalFault`),
    submittedAt,
    reportedAt,
    expectedVerdict: enumeration(item.expectedVerdict, VERDICTS, `records[${index}].expectedVerdict`),
    actualVerdict: enumeration(item.actualVerdict, VERDICTS, `records[${index}].actualVerdict`),
    evidenceIds: strings(item.evidenceIds, `records[${index}].evidenceIds`),
    expectedDiagnosisCode: nullableString(item.expectedDiagnosisCode, `records[${index}].expectedDiagnosisCode`),
    actualDiagnosisCode: nullableString(item.actualDiagnosisCode, `records[${index}].actualDiagnosisCode`),
    diagnosisEvidenceIds: strings(item.diagnosisEvidenceIds, `records[${index}].diagnosisEvidenceIds`),
    ambiguousJoinCount: integer(item.ambiguousJoinCount, `records[${index}].ambiguousJoinCount`),
    articleTransitions: integer(item.articleTransitions, `records[${index}].articleTransitions`),
    costUsd: item.costUsd === null ? null : number(item.costUsd, `records[${index}].costUsd`),
  };
  if (parsed.criticalFault && parsed.expectedVerdict !== "FAIL") throw new TypeError(`records[${index}] criticalFault requires expectedVerdict FAIL`);
  if (parsed.scenarioKind === "ambiguous" && parsed.expectedVerdict !== "UNKNOWN") throw new TypeError(`records[${index}] ambiguous scenarios require expectedVerdict UNKNOWN`);
  return parsed;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
}

export function evaluatePilot(value: unknown): PilotEvaluation {
  const input = object(value, "pilot input");
  const declaredConcurrency = integer(input.declaredConcurrency, "declaredConcurrency", 1);
  const decisionsConfirmed = boolean(input.decisionsConfirmed, "decisionsConfirmed");
  const securityControlsPassed = boolean(input.accessRedactionAndEgressPassed, "accessRedactionAndEgressPassed");
  if (!Array.isArray(input.records)) throw new TypeError("records must be an array");
  const records = input.records.map(parseRecord);

  const durations = records.map((item) => Date.parse(item.reportedAt) - Date.parse(item.submittedAt));
  const healthy = records.filter((item) => item.scenarioKind === "healthy");
  const seededCritical = records.filter((item) => item.criticalFault);
  const expectedFailures = records.filter((item) => item.expectedVerdict === "FAIL");
  const actualFailures = records.filter((item) => item.actualVerdict === "FAIL");
  const trueFailures = actualFailures.filter((item) => item.expectedVerdict === "FAIL");
  const diagnosisExpected = records.filter((item) => item.expectedDiagnosisCode !== null);
  const diagnosisComplete = diagnosisExpected.filter((item) => item.actualDiagnosisCode === item.expectedDiagnosisCode && item.diagnosisEvidenceIds.length > 0);
  const evidenceDefects = records.filter((item) => ["FAIL", "WARNING"].includes(item.actualVerdict) && item.evidenceIds.length === 0).length
    + records.filter((item) => item.actualDiagnosisCode !== null && item.diagnosisEvidenceIds.length === 0).length;
  const requiredKeys = CASE_IDS.flatMap((caseId) => DEVICE_CLASSES.flatMap((device) => ["healthy", "fault_or_boundary"].map((kind) => `${caseId}|${device}|${kind}`)));
  const observedKeys = new Set(records.map((item) => `${item.testCaseId}|${item.deviceClass}|${item.scenarioKind}`));
  const completeKeys = requiredKeys.filter((key) => observedKeys.has(key)).length;
  const costRecords = records.filter((item) => item.costUsd !== null);
  const ambiguous = records.filter((item) => item.scenarioKind === "ambiguous");

  const gates = {
    noHealthyFalseFailures: healthy.length > 0 && healthy.every((item) => item.actualVerdict !== "FAIL"),
    seededCriticalFaultsDetected: seededCritical.length > 0 && seededCritical.every((item) => item.actualVerdict === "FAIL"),
    ambiguousEvidenceRemainsUnknown: ambiguous.length > 0 && ambiguous.every((item) => item.actualVerdict === "UNKNOWN"),
    evidenceAndDiagnosisReferencesPresent: evidenceDefects === 0,
    expectedDiagnosesComplete: diagnosisExpected.length > 0 && diagnosisComplete.length === diagnosisExpected.length,
    caseDeviceScenarioCoverageComplete: completeKeys === requiredKeys.length,
    threeArticleTransitionsComplete: records.filter((item) => item.testCaseId === "TC-23").length > 0
      && records.filter((item) => item.testCaseId === "TC-23").every((item) => item.articleTransitions >= 3),
    decisionsConfirmed,
    accessRedactionAndEgressPassed: securityControlsPassed,
    latencyP95Within300Seconds: durations.length > 0 && percentile(durations, 0.95)! <= 300_000,
    costMeasured: records.length > 0 && costRecords.length === records.length,
  };
  const labels: Record<keyof typeof gates, string> = {
    noHealthyFalseFailures: "healthy corpus contains a false failure or is empty",
    seededCriticalFaultsDetected: "seeded critical faults were not all detected",
    ambiguousEvidenceRemainsUnknown: "ambiguous evidence was not retained as UNKNOWN or is absent",
    evidenceAndDiagnosisReferencesPresent: "a finding or diagnosis lacks evidence references",
    expectedDiagnosesComplete: "expected QA diagnoses are missing or disagree with the validator",
    caseDeviceScenarioCoverageComplete: "TC/device healthy and fault-or-boundary coverage is incomplete",
    threeArticleTransitionsComplete: "TC-23 lacks three transitions on every recorded scenario",
    decisionsConfirmed: "relevant draft rule decisions are unconfirmed",
    accessRedactionAndEgressPassed: "access, redaction and deployed egress checks have not passed",
    latencyP95Within300Seconds: "p95 submission-to-report exceeds 300 seconds or is unavailable",
    costMeasured: "cost was not recorded for every corpus observation",
  };
  const failures = (Object.entries(gates) as Array<[keyof typeof gates, boolean]>).filter(([, passed]) => !passed).map(([gate]) => labels[gate]);

  return {
    corpus: {
      records: records.length,
      distinctScenarios: new Set(records.map((item) => item.scenarioId)).size,
      declaredConcurrency,
      completeCaseDeviceKinds: completeKeys,
      requiredCaseDeviceKinds: requiredKeys.length,
    },
    metrics: {
      submissionToReportP50Ms: percentile(durations, 0.5),
      submissionToReportP95Ms: percentile(durations, 0.95),
      diagnosisCompleteness: ratio(diagnosisComplete.length, diagnosisExpected.length),
      falsePositiveRate: ratio(healthy.filter((item) => item.actualVerdict === "FAIL").length, healthy.length),
      recall: ratio(trueFailures.length, expectedFailures.length),
      precision: ratio(trueFailures.length, actualFailures.length),
      ambiguousJoinCount: records.reduce((sum, item) => sum + item.ambiguousJoinCount, 0),
      evidenceAccessDefects: evidenceDefects,
      measuredCostUsd: costRecords.length === 0 ? null : costRecords.reduce((sum, item) => sum + item.costUsd!, 0),
      costCoverage: ratio(costRecords.length, records.length) ?? 0,
    },
    gates,
    releaseReady: failures.length === 0,
    failures,
  };
}
