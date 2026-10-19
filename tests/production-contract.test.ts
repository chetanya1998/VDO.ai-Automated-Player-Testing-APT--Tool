import assert from "node:assert/strict";
import test from "node:test";
import { parseProductionContract } from "../src/production/contract.js";

const sha256 = `sha256:${"a".repeat(64)}`;
const evidence = [{ evidenceId: "owner/approval-record", sha256 }];
const kinds = ["profile", "event_aliases", "timing", "event_rules", "runtime", "demand", "auction", "visibility", "article", "device", "rca"];

function contract() {
  return {
    schemaVersion: 1,
    contractId: "production-contract-2026-10",
    status: "approved",
    approvedAt: "2026-10-20T00:00:00.000Z",
    approvedBy: ["Product Owner", "Platform Owner"],
    environments: {
      staging: { frontendOrigin: "https://validator-staging.example.com", apiOrigin: "https://api-validator-staging.example.com" },
      production: { frontendOrigin: "https://validator.example.com", apiOrigin: "https://api-validator.example.com" },
    },
    identity: { mode: "rotating_bearer", owner: "Security", rotationDays: 30, evidence },
    storage: { mode: "s3", owner: "Platform", backupDestination: "approved-backup-vault", restoreEvidence: evidence },
    logger: { enabled: false, owner: "Backend", endpoint: null, credentialReference: null, sharedCorrelationKey: null, evidence },
    decisions: Array.from({ length: 14 }, (_, index) => ({ decisionId: `D${String(index + 1).padStart(2, "0")}`, confirmedBy: "Named Owner", evidence })),
    policies: kinds.map((kind) => ({ kind, path: `config/production-${kind}.json`, sha256, approvedBy: "Named Owner" })),
  };
}

test("approved production contract binds owners, environments, decisions and policies", () => {
  const parsed = parseProductionContract(contract());
  assert.equal(parsed.status, "approved");
  assert.equal(parsed.decisions.length, 14);
  assert.equal(parsed.policies.length, 11);
  assert.equal(parsed.environments.production.frontendOrigin, "https://validator.example.com");
});

test("production contract fails closed for draft, incomplete and unsafe inputs", () => {
  assert.throws(() => parseProductionContract({ ...contract(), status: "draft" }), /status must be approved/);
  assert.throws(() => parseProductionContract({ ...contract(), decisions: contract().decisions.slice(1) }), /D01 through D14/);
  assert.throws(() => parseProductionContract({ ...contract(), policies: contract().policies.slice(1) }), /every required policy/);
  assert.throws(() => parseProductionContract({ ...contract(), environments: { ...contract().environments, production: { frontendOrigin: "http:\/\/validator.example.com", apiOrigin: "https:\/\/api-validator.example.com" } } }), /HTTPS origin/);
});

test("logger access details are required only when real collection is enabled", () => {
  assert.throws(() => parseProductionContract({ ...contract(), logger: { ...contract().logger, enabled: true } }), /enabled logger requires/);
  assert.doesNotThrow(() => parseProductionContract({ ...contract(), logger: { enabled: true, owner: "Backend", endpoint: "https://logger.example.com", credentialReference: "secret-manager/logger-reader", sharedCorrelationKey: "auctionId", evidence } }));
});
