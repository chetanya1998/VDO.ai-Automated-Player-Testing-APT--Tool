import assert from "node:assert/strict";
import test from "node:test";
import { DEPLOYMENT_CONTROLS, assertDeploymentAcceptance, assertTargetAdmission, parseDeploymentAcceptance, type DeploymentAcceptance } from "../src/deploy/acceptance.js";
import { snapshotProfile } from "../src/profile.js";

const evidenceDigest = `sha256:${"a".repeat(64)}`;
const browserDigest = `sha256:${"b".repeat(64)}`;

function productionSnapshot(resourceOrigins: string[] = []) {
  return snapshotProfile({
    schemaVersion: 1,
    profileId: "approved-production-profile",
    profileStatus: "production",
    site: { approvedUrls: ["https://1.1.1.1/article"], approvedResourceOrigins: resourceOrigins },
    devices: [{ id: "desktop", state: "enabled" }],
    logger: { backendCorrelation: { state: "disabled" } },
  });
}

function acceptance(profileHash: string, overrides: Partial<DeploymentAcceptance> = {}): DeploymentAcceptance {
  const now = Date.now();
  return {
    schemaVersion: 1,
    acceptanceId: "acceptance-real-deployment-evidence",
    environmentId: "pilot-environment",
    evaluatedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 24 * 60 * 60_000).toISOString(),
    browserImageDigest: browserDigest,
    approvedProfileHashes: [profileHash],
    approvedOrigins: ["https://1.1.1.1"],
    checks: DEPLOYMENT_CONTROLS.map((control) => ({ control, state: "passed", evidence: [{ evidenceId: `deployment/${control}`, sha256: evidenceDigest }] })),
    ...overrides,
  };
}

test("complete fresh deployment evidence admits only the exact profile and origins", async () => {
  const snapshot = productionSnapshot();
  const accepted = parseDeploymentAcceptance(acceptance(snapshot.profileHash));
  assert.doesNotThrow(() => assertDeploymentAcceptance({ acceptance: accepted, browserImageDigest: browserDigest, profileHash: snapshot.profileHash, requiredOrigins: ["https://1.1.1.1"] }));
  await assert.doesNotReject(assertTargetAdmission(snapshot, "https://1.1.1.1/article", accepted, browserDigest));

  const changedProfile = productionSnapshot(["https://8.8.8.8"]);
  await assert.rejects(assertTargetAdmission(changedProfile, "https://1.1.1.1/article", accepted, browserDigest), /profile hash is not covered/);
});

test("missing controls, stale acceptance and uncovered origins fail closed", () => {
  const snapshot = productionSnapshot();
  const complete = acceptance(snapshot.profileHash);
  assert.throws(() => parseDeploymentAcceptance({ ...complete, checks: complete.checks.slice(1) }), /missing controls/);
  assert.throws(() => assertDeploymentAcceptance({
    acceptance: { ...complete, evaluatedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z" },
    browserImageDigest: browserDigest,
    profileHash: snapshot.profileHash,
    requiredOrigins: ["https://1.1.1.1"],
    now: new Date("2026-01-03T00:00:00.000Z"),
  }), /expired/);
  assert.throws(() => assertDeploymentAcceptance({ acceptance: complete, browserImageDigest: browserDigest, profileHash: snapshot.profileHash, requiredOrigins: ["https://8.8.8.8"] }), /origins are not covered/);
  assert.throws(() => assertDeploymentAcceptance({ acceptance: complete, browserImageDigest: `sha256:${"c".repeat(64)}`, profileHash: snapshot.profileHash, requiredOrigins: ["https://1.1.1.1"] }), /browser image digest/);
});

test("production admission never falls back to fixture or URL proximity", async () => {
  const snapshot = productionSnapshot();
  await assert.rejects(assertTargetAdmission(snapshot, "https://1.1.1.1/article"), /no deployment acceptance/);
  await assert.rejects(assertTargetAdmission(snapshot, "https://1.1.1.1/other", acceptance(snapshot.profileHash), browserDigest), /listed in profile/);
});
