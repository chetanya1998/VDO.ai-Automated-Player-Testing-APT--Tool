import type { ProfileSnapshot } from "../profile.js";
import { NetworkUrlGuard, createBrowserUrlPolicy } from "../browser/url-policy.js";

export const DEPLOYMENT_CONTROLS = [
  "separate_api_worker_browser_collector",
  "browser_network_namespace",
  "browser_secret_isolation",
  "private_ipv4_blocked",
  "private_ipv6_blocked",
  "link_local_metadata_blocked",
  "public_to_private_redirect_blocked",
  "dns_rebinding_blocked",
  "hostile_frame_blocked",
  "websocket_policy_enforced",
  "team_authorization_verified",
  "artifact_retention_verified",
  "quota_exhaustion_verified",
  "process_cleanup_verified",
  "restore_verified",
  "approved_public_page_verified",
] as const;

export type DeploymentControl = (typeof DEPLOYMENT_CONTROLS)[number];

export interface DeploymentAcceptance {
  schemaVersion: 1;
  acceptanceId: string;
  environmentId: string;
  evaluatedAt: string;
  expiresAt: string;
  browserImageDigest: string;
  approvedProfileHashes: string[];
  approvedOrigins: string[];
  checks: Array<{
    control: DeploymentControl;
    state: "passed";
    evidence: Array<{ evidenceId: string; sha256: string }>;
  }>;
}

export class DeploymentAcceptanceError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "DeploymentAcceptanceError";
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new DeploymentAcceptanceError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DeploymentAcceptanceError(`${path} must be a non-empty string`);
  return value;
}

function sha256(value: unknown, path: string): string {
  const digest = text(value, path);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new DeploymentAcceptanceError(`${path} must be a lowercase SHA-256 digest`);
  return digest;
}

function instant(value: unknown, path: string): string {
  const result = text(value, path);
  if (!Number.isFinite(Date.parse(result))) throw new DeploymentAcceptanceError(`${path} must be an ISO timestamp`);
  return result;
}

function uniqueStrings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new DeploymentAcceptanceError(`${path} must be a non-empty array`);
  const items = value.map((item, index) => text(item, `${path}[${index}]`));
  if (new Set(items).size !== items.length) throw new DeploymentAcceptanceError(`${path} must not contain duplicates`);
  return items;
}

function origin(value: string, path: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new DeploymentAcceptanceError(`${path} must be an HTTPS origin`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new DeploymentAcceptanceError(`${path} must be an HTTPS origin`);
  }
  return parsed.origin;
}

export function parseDeploymentAcceptance(value: unknown): DeploymentAcceptance {
  const input = object(value, "deployment acceptance");
  if (input.schemaVersion !== 1) throw new DeploymentAcceptanceError("deployment acceptance.schemaVersion must be 1");
  const approvedProfileHashes = uniqueStrings(input.approvedProfileHashes, "deployment acceptance.approvedProfileHashes")
    .map((item, index) => sha256(item, `deployment acceptance.approvedProfileHashes[${index}]`));
  const approvedOrigins = uniqueStrings(input.approvedOrigins, "deployment acceptance.approvedOrigins")
    .map((item, index) => origin(item, `deployment acceptance.approvedOrigins[${index}]`));
  if (!Array.isArray(input.checks)) throw new DeploymentAcceptanceError("deployment acceptance.checks must be an array");
  const checks = input.checks.map((value, index) => {
    const check = object(value, `deployment acceptance.checks[${index}]`);
    if (typeof check.control !== "string" || !(DEPLOYMENT_CONTROLS as readonly string[]).includes(check.control)) {
      throw new DeploymentAcceptanceError(`deployment acceptance.checks[${index}].control is invalid`);
    }
    if (check.state !== "passed") throw new DeploymentAcceptanceError(`deployment acceptance.checks[${index}].state must be passed`);
    if (!Array.isArray(check.evidence) || check.evidence.length === 0) throw new DeploymentAcceptanceError(`deployment acceptance.checks[${index}].evidence must not be empty`);
    const evidence = check.evidence.map((value, evidenceIndex) => {
      const item = object(value, `deployment acceptance.checks[${index}].evidence[${evidenceIndex}]`);
      return { evidenceId: text(item.evidenceId, `deployment acceptance.checks[${index}].evidence[${evidenceIndex}].evidenceId`), sha256: sha256(item.sha256, `deployment acceptance.checks[${index}].evidence[${evidenceIndex}].sha256`) };
    });
    return { control: check.control as DeploymentControl, state: "passed" as const, evidence };
  });
  const controls = checks.map((check) => check.control);
  if (new Set(controls).size !== controls.length) throw new DeploymentAcceptanceError("deployment acceptance checks must not contain duplicate controls");
  const missing = DEPLOYMENT_CONTROLS.filter((control) => !controls.includes(control));
  if (missing.length > 0) throw new DeploymentAcceptanceError(`deployment acceptance is missing controls: ${missing.join(", ")}`);
  return {
    schemaVersion: 1,
    acceptanceId: text(input.acceptanceId, "deployment acceptance.acceptanceId"),
    environmentId: text(input.environmentId, "deployment acceptance.environmentId"),
    evaluatedAt: instant(input.evaluatedAt, "deployment acceptance.evaluatedAt"),
    expiresAt: instant(input.expiresAt, "deployment acceptance.expiresAt"),
    browserImageDigest: sha256(input.browserImageDigest, "deployment acceptance.browserImageDigest"),
    approvedProfileHashes,
    approvedOrigins,
    checks,
  };
}

export function assertDeploymentAcceptance(input: {
  acceptance: DeploymentAcceptance;
  browserImageDigest: string;
  profileHash: string;
  requiredOrigins: readonly string[];
  now?: Date;
}): void {
  const acceptance = parseDeploymentAcceptance(input.acceptance);
  const now = (input.now ?? new Date()).getTime();
  const evaluated = Date.parse(acceptance.evaluatedAt);
  const expires = Date.parse(acceptance.expiresAt);
  if (evaluated > now + 5 * 60_000) throw new DeploymentAcceptanceError("deployment acceptance evaluation time is in the future");
  if (expires <= evaluated || expires - evaluated > 30 * 24 * 60 * 60_000) throw new DeploymentAcceptanceError("deployment acceptance validity must be greater than zero and at most 30 days");
  if (expires <= now) throw new DeploymentAcceptanceError("deployment acceptance has expired");
  if (acceptance.browserImageDigest !== sha256(input.browserImageDigest, "running browser image digest")) throw new DeploymentAcceptanceError("browser image digest is not covered by deployment acceptance");
  if (!acceptance.approvedProfileHashes.includes(input.profileHash)) throw new DeploymentAcceptanceError("profile hash is not covered by deployment acceptance");
  const approved = new Set(acceptance.approvedOrigins);
  const missingOrigins = input.requiredOrigins.map((value) => new URL(value).origin).filter((value) => !approved.has(value));
  if (missingOrigins.length > 0) throw new DeploymentAcceptanceError(`origins are not covered by deployment acceptance: ${[...new Set(missingOrigins)].join(", ")}`);
}

export async function assertTargetAdmission(snapshot: ProfileSnapshot, targetUrl: string, acceptance?: DeploymentAcceptance, browserImageDigest?: string): Promise<void> {
  if (!snapshot.profile.site.approvedUrls.includes(targetUrl)) throw new DeploymentAcceptanceError("targetUrl must be listed in profile.site.approvedUrls");
  const remote = snapshot.profile.profileStatus === "production";
  const origins = [...new Set([
    ...(remote ? snapshot.profile.site.approvedUrls.map((value) => new URL(value).origin) : [new URL(targetUrl).origin]),
    ...(snapshot.profile.site.approvedResourceOrigins ?? []).map((value) => new URL(value).origin),
  ])];
  if (remote) {
    if (acceptance === undefined || browserImageDigest === undefined) throw new DeploymentAcceptanceError("remote execution has no deployment acceptance");
    assertDeploymentAcceptance({ acceptance, browserImageDigest, profileHash: snapshot.profileHash, requiredOrigins: origins });
  }
  await new NetworkUrlGuard(createBrowserUrlPolicy(origins, remote)).assertAllowed(targetUrl);
}
