import { ISSUE_CATEGORIES, type CheckResult, type Evidence, type IssueCategory, type TestCaseId, type Verdict } from "../contracts.js";

export const RCA_CONFIDENCE = ["supported", "possible", "unknown"] as const;
export type RcaConfidence = (typeof RCA_CONFIDENCE)[number];

export interface RcaRule {
  id: string;
  testCaseIds: TestCaseId[];
  categories: IssueCategory[];
  observedContains: string[];
  cause: string;
  basis: "observation" | "inference";
  confidence: RcaConfidence;
  suggestedOwner: string;
  nextChecks: string[];
  groupTestCaseIds: TestCaseId[];
  groupCategories: IssueCategory[];
}

export interface RcaPolicy {
  schemaVersion: number;
  policyId: string;
  profileId: string;
  status: "draft" | "confirmed";
  lifecycleOrder: TestCaseId[];
  conflictSignals: string[];
  rules: RcaRule[];
}

export interface DiagnosticSymptom {
  testCaseId: TestCaseId;
  verdict: Verdict;
  observed: CheckResult["observed"];
  evidenceIds: string[];
}

export interface Diagnosis {
  diagnosisId: string;
  primarySymptom: DiagnosticSymptom;
  groupedSymptoms: DiagnosticSymptom[];
  probableCause: {
    code: string;
    summary: string;
    basis: RcaRule["basis"];
    confidence: RcaConfidence;
    evidenceIds: string[];
  };
  category: IssueCategory;
  suggestedOwner: string;
  nextChecks: string[];
  conflicts: string[];
}

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

function testCases(value: unknown, path: string, allowEmpty = false): TestCaseId[] {
  return strings(value, path, allowEmpty).map((item, index) => {
    if (!/^TC-([1-9]|1\d|2[0-3])$/.test(item)) throw new TypeError(`${path}[${index}] must be TC-1 through TC-23`);
    return item as TestCaseId;
  });
}

function categories(value: unknown, path: string, allowEmpty = false): IssueCategory[] {
  return strings(value, path, allowEmpty).map((item, index) => {
    if (!(ISSUE_CATEGORIES as readonly string[]).includes(item)) throw new TypeError(`${path}[${index}] is not an issue category`);
    return item as IssueCategory;
  });
}

export function parseRcaPolicy(value: unknown): RcaPolicy {
  const root = object(value, "rcaPolicy");
  if (!Number.isInteger(root.schemaVersion) || Number(root.schemaVersion) < 1) throw new TypeError("rcaPolicy.schemaVersion must be a positive integer");
  if (root.status !== "draft" && root.status !== "confirmed") throw new TypeError("rcaPolicy.status must be draft or confirmed");
  const lifecycleOrder = testCases(root.lifecycleOrder, "rcaPolicy.lifecycleOrder");
  if (new Set(lifecycleOrder).size !== lifecycleOrder.length) throw new TypeError("rcaPolicy.lifecycleOrder must not contain duplicates");
  if (!Array.isArray(root.rules) || root.rules.length === 0) throw new TypeError("rcaPolicy.rules must be a non-empty array");
  const rules = root.rules.map((value, index): RcaRule => {
    const rule = object(value, `rcaPolicy.rules[${index}]`);
    if (rule.basis !== "observation" && rule.basis !== "inference") throw new TypeError(`rcaPolicy.rules[${index}].basis must be observation or inference`);
    if (!(RCA_CONFIDENCE as readonly unknown[]).includes(rule.confidence)) throw new TypeError(`rcaPolicy.rules[${index}].confidence is invalid`);
    return {
      id: text(rule.id, `rcaPolicy.rules[${index}].id`),
      testCaseIds: testCases(rule.testCaseIds, `rcaPolicy.rules[${index}].testCaseIds`),
      categories: categories(rule.categories, `rcaPolicy.rules[${index}].categories`),
      observedContains: strings(rule.observedContains, `rcaPolicy.rules[${index}].observedContains`, true).map((item) => item.toLowerCase()),
      cause: text(rule.cause, `rcaPolicy.rules[${index}].cause`),
      basis: rule.basis,
      confidence: rule.confidence as RcaConfidence,
      suggestedOwner: text(rule.suggestedOwner, `rcaPolicy.rules[${index}].suggestedOwner`),
      nextChecks: strings(rule.nextChecks, `rcaPolicy.rules[${index}].nextChecks`),
      groupTestCaseIds: testCases(rule.groupTestCaseIds, `rcaPolicy.rules[${index}].groupTestCaseIds`, true),
      groupCategories: categories(rule.groupCategories, `rcaPolicy.rules[${index}].groupCategories`, true),
    };
  });
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length) throw new TypeError("rcaPolicy rule ids must be unique");
  return {
    schemaVersion: Number(root.schemaVersion),
    policyId: text(root.policyId, "rcaPolicy.policyId"),
    profileId: text(root.profileId, "rcaPolicy.profileId"),
    status: root.status,
    lifecycleOrder,
    conflictSignals: strings(root.conflictSignals, "rcaPolicy.conflictSignals", true).map((item) => item.toLowerCase()),
    rules,
  };
}

function symptom(check: CheckResult): DiagnosticSymptom {
  return { testCaseId: check.testCaseId, verdict: check.verdict, observed: check.observed, evidenceIds: [...check.evidenceIds] };
}

function samePath(left: CheckResult, right: CheckResult): boolean {
  if (left.scope.deviceId !== right.scope.deviceId) return false;
  if (left.scope.articleEpochId !== null && right.scope.articleEpochId !== null && left.scope.articleEpochId !== right.scope.articleEpochId) return false;
  return left.scope.tagName === null || right.scope.tagName === null || left.scope.tagName === right.scope.tagName;
}

function matchingRule(check: CheckResult, policy: RcaPolicy): RcaRule | undefined {
  const observed = JSON.stringify(check.observed).toLowerCase();
  return policy.rules.find((rule) => rule.testCaseIds.includes(check.testCaseId)
    && rule.categories.includes(check.category)
    && rule.observedContains.every((part) => observed.includes(part)));
}

function confidence(rule: RcaRule, check: CheckResult, conflicts: readonly string[]): RcaConfidence {
  if (check.verdict === "UNKNOWN") return "unknown";
  if (conflicts.length > 0 && rule.confidence === "supported") return "possible";
  return rule.confidence;
}

export function diagnose(checks: readonly CheckResult[], evidence: readonly Evidence[], inputPolicy: RcaPolicy): Diagnosis[] {
  const policy = parseRcaPolicy(inputPolicy);
  const knownEvidence = new Set(evidence.map((item) => item.evidenceId));
  const lifecycle = new Map(policy.lifecycleOrder.map((testCaseId, index) => [testCaseId, index]));
  const candidates = checks.filter((check) => ["FAIL", "WARNING", "UNKNOWN"].includes(check.verdict) && check.evidenceIds.length > 0)
    .map((check) => ({ check, rule: matchingRule(check, policy) }))
    .filter((item): item is { check: CheckResult; rule: RcaRule } => item.rule !== undefined)
    .sort((left, right) => (lifecycle.get(left.check.testCaseId) ?? 99) - (lifecycle.get(right.check.testCaseId) ?? 99));
  for (const { check } of candidates) {
    const missing = check.evidenceIds.filter((id) => !knownEvidence.has(id));
    if (missing.length > 0) throw new TypeError(`${check.testCaseId} diagnosis references unknown evidence: ${missing.join(", ")}`);
  }

  const consumed = new Set<CheckResult>();
  const diagnoses: Diagnosis[] = [];
  for (const primary of candidates) {
    if (consumed.has(primary.check)) continue;
    consumed.add(primary.check);
    const grouped = candidates.filter((candidate) => !consumed.has(candidate.check)
      && primary.rule.groupTestCaseIds.includes(candidate.check.testCaseId)
      && primary.rule.groupCategories.includes(candidate.check.category)
      && samePath(primary.check, candidate.check));
    grouped.forEach((item) => consumed.add(item.check));
    const allChecks = [primary.check, ...grouped.map((item) => item.check)];
    const evidenceIds = [...new Set(allChecks.flatMap((check) => check.evidenceIds))];
    const observed = JSON.stringify(primary.check.observed).toLowerCase();
    const conflicts = policy.conflictSignals.filter((signal) => observed.includes(signal)).map((signal) => `Observed evidence also contains '${signal}'.`);
    diagnoses.push({
      diagnosisId: `rca-${primary.check.scope.deviceId}-${primary.check.testCaseId}-${diagnoses.length + 1}`,
      primarySymptom: symptom(primary.check),
      groupedSymptoms: grouped.map((item) => symptom(item.check)),
      probableCause: {
        code: primary.rule.id,
        summary: primary.rule.cause,
        basis: primary.rule.basis,
        confidence: confidence(primary.rule, primary.check, conflicts),
        evidenceIds,
      },
      category: primary.check.category,
      suggestedOwner: primary.rule.suggestedOwner,
      nextChecks: [...primary.rule.nextChecks],
      conflicts,
    });
  }
  return diagnoses;
}
