const DECISION_IDS = Array.from({ length: 14 }, (_, index) => `D${String(index + 1).padStart(2, "0")}`);
const POLICY_KINDS = ["profile", "event_aliases", "timing", "event_rules", "runtime", "demand", "auction", "visibility", "article", "device", "rca"] as const;

type PolicyKind = typeof POLICY_KINDS[number];

export interface ProductionContract {
  schemaVersion: 1;
  contractId: string;
  status: "approved";
  approvedAt: string;
  approvedBy: string[];
  environments: {
    staging: { frontendOrigin: string; apiOrigin: string };
    production: { frontendOrigin: string; apiOrigin: string };
  };
  identity: {
    mode: "managed_oidc" | "rotating_bearer";
    owner: string;
    rotationDays: number;
    evidence: EvidenceReference[];
  };
  storage: {
    mode: "s3" | "single_host_volume";
    owner: string;
    backupDestination: string;
    restoreEvidence: EvidenceReference[];
  };
  logger: {
    enabled: boolean;
    owner: string;
    endpoint: string | null;
    credentialReference: string | null;
    sharedCorrelationKey: string | null;
    evidence: EvidenceReference[];
  };
  decisions: Array<{ decisionId: string; confirmedBy: string; evidence: EvidenceReference[] }>;
  policies: Array<{ kind: PolicyKind; path: string; sha256: string; approvedBy: string }>;
}

interface EvidenceReference { evidenceId: string; sha256: string }

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

function httpsOrigin(value: unknown, path: string): string {
  const result = text(value, path);
  const parsed = new URL(result);
  if (parsed.protocol !== "https:" || parsed.origin !== result) throw new TypeError(`${path} must be an exact HTTPS origin`);
  return result;
}

function evidence(value: unknown, path: string): EvidenceReference[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${path} must contain real evidence`);
  const result = value.map((entry, index) => {
    const item = object(entry, `${path}[${index}]`);
    return { evidenceId: text(item.evidenceId, `${path}[${index}].evidenceId`), sha256: digest(item.sha256, `${path}[${index}].sha256`) };
  });
  if (new Set(result.map((item) => item.evidenceId)).size !== result.length) throw new TypeError(`${path} contains duplicate evidence IDs`);
  return result;
}

function environment(value: unknown, path: string): { frontendOrigin: string; apiOrigin: string } {
  const item = object(value, path);
  const result = { frontendOrigin: httpsOrigin(item.frontendOrigin, `${path}.frontendOrigin`), apiOrigin: httpsOrigin(item.apiOrigin, `${path}.apiOrigin`) };
  if (result.frontendOrigin === result.apiOrigin) throw new TypeError(`${path} frontend and API origins must be separate`);
  return result;
}

export function parseProductionContract(value: unknown): ProductionContract {
  const input = object(value, "production contract");
  if (input.schemaVersion !== 1) throw new TypeError("production contract.schemaVersion must be 1");
  if (input.status !== "approved") throw new TypeError("production contract.status must be approved");
  const approvedAt = text(input.approvedAt, "production contract.approvedAt");
  if (!Number.isFinite(Date.parse(approvedAt))) throw new TypeError("production contract.approvedAt must be an ISO timestamp");
  if (!Array.isArray(input.approvedBy) || input.approvedBy.length === 0) throw new TypeError("production contract.approvedBy must not be empty");
  const approvedBy = input.approvedBy.map((item, index) => text(item, `production contract.approvedBy[${index}]`));

  const environments = object(input.environments, "production contract.environments");
  const staging = environment(environments.staging, "production contract.environments.staging");
  const production = environment(environments.production, "production contract.environments.production");
  if ([staging.frontendOrigin, staging.apiOrigin].some((origin) => origin === production.frontendOrigin || origin === production.apiOrigin)) {
    throw new TypeError("staging and production origins must be separate");
  }

  const identityInput = object(input.identity, "production contract.identity");
  if (identityInput.mode !== "managed_oidc" && identityInput.mode !== "rotating_bearer") throw new TypeError("production contract.identity.mode is invalid");
  if (!Number.isInteger(identityInput.rotationDays) || Number(identityInput.rotationDays) < 1 || Number(identityInput.rotationDays) > 365) {
    throw new TypeError("production contract.identity.rotationDays must be an integer from 1 to 365");
  }
  const identity: ProductionContract["identity"] = { mode: identityInput.mode, owner: text(identityInput.owner, "production contract.identity.owner"), rotationDays: Number(identityInput.rotationDays), evidence: evidence(identityInput.evidence, "production contract.identity.evidence") };

  const storageInput = object(input.storage, "production contract.storage");
  if (storageInput.mode !== "s3" && storageInput.mode !== "single_host_volume") throw new TypeError("production contract.storage.mode is invalid");
  const storage: ProductionContract["storage"] = { mode: storageInput.mode, owner: text(storageInput.owner, "production contract.storage.owner"), backupDestination: text(storageInput.backupDestination, "production contract.storage.backupDestination"), restoreEvidence: evidence(storageInput.restoreEvidence, "production contract.storage.restoreEvidence") };

  const loggerInput = object(input.logger, "production contract.logger");
  if (typeof loggerInput.enabled !== "boolean") throw new TypeError("production contract.logger.enabled must be a boolean");
  const nullable = (entry: unknown, path: string) => entry === null ? null : text(entry, path);
  const logger = {
    enabled: loggerInput.enabled,
    owner: text(loggerInput.owner, "production contract.logger.owner"),
    endpoint: loggerInput.endpoint === null ? null : httpsOrigin(loggerInput.endpoint, "production contract.logger.endpoint"),
    credentialReference: nullable(loggerInput.credentialReference, "production contract.logger.credentialReference"),
    sharedCorrelationKey: nullable(loggerInput.sharedCorrelationKey, "production contract.logger.sharedCorrelationKey"),
    evidence: evidence(loggerInput.evidence, "production contract.logger.evidence"),
  };
  if (logger.enabled && (logger.endpoint === null || logger.credentialReference === null || logger.sharedCorrelationKey === null)) throw new TypeError("enabled logger requires endpoint, credential reference and shared correlation key");
  if (!logger.enabled && (logger.endpoint !== null || logger.credentialReference !== null || logger.sharedCorrelationKey !== null)) throw new TypeError("disabled logger configuration must not contain access details");

  if (!Array.isArray(input.decisions)) throw new TypeError("production contract.decisions must be an array");
  const decisions = input.decisions.map((entry, index) => {
    const item = object(entry, `production contract.decisions[${index}]`);
    return { decisionId: text(item.decisionId, `production contract.decisions[${index}].decisionId`), confirmedBy: text(item.confirmedBy, `production contract.decisions[${index}].confirmedBy`), evidence: evidence(item.evidence, `production contract.decisions[${index}].evidence`) };
  });
  const decisionIds = decisions.map((item) => item.decisionId);
  if (decisionIds.length !== 14 || new Set(decisionIds).size !== 14 || !DECISION_IDS.every((id) => decisionIds.includes(id))) throw new TypeError("production contract must confirm D01 through D14 exactly once");

  if (!Array.isArray(input.policies)) throw new TypeError("production contract.policies must be an array");
  const policies = input.policies.map((entry, index) => {
    const item = object(entry, `production contract.policies[${index}]`);
    const kind = text(item.kind, `production contract.policies[${index}].kind`);
    if (!POLICY_KINDS.includes(kind as PolicyKind)) throw new TypeError(`production contract.policies[${index}].kind is invalid`);
    return { kind: kind as PolicyKind, path: text(item.path, `production contract.policies[${index}].path`), sha256: digest(item.sha256, `production contract.policies[${index}].sha256`), approvedBy: text(item.approvedBy, `production contract.policies[${index}].approvedBy`) };
  });
  const policyKinds = policies.map((item) => item.kind);
  if (policyKinds.length !== POLICY_KINDS.length || new Set(policyKinds).size !== POLICY_KINDS.length || !POLICY_KINDS.every((kind) => policyKinds.includes(kind))) throw new TypeError("production contract must bind every required policy kind exactly once");

  return { schemaVersion: 1, contractId: text(input.contractId, "production contract.contractId"), status: "approved", approvedAt, approvedBy, environments: { staging, production }, identity, storage, logger, decisions, policies };
}
