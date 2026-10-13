export const PRODUCTION_EGRESS_BOUNDARY = {
  state: "deferred_to_task_20",
  currentMode: "fixture_origin_only",
  unrestrictedRemoteExecution: false,
  enforcedAt: "browser_context_request_route",
  limitations: ["websocket_and_dns_controls_require_deployment_network_policy"],
} as const;

export interface FixtureUrlPolicy {
  mode: "fixture_only";
  approvedOrigins: ReadonlySet<string>;
}

export class UrlPolicyError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "UrlPolicyError";
  }
}

function parseHttpUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UrlPolicyError(`${label} must be a valid URL`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new UrlPolicyError(`${label} must be an HTTP(S) URL without credentials`);
  }
  return url;
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "[::1]";
}

export function createFixtureUrlPolicy(approvedOrigins: readonly string[]): FixtureUrlPolicy {
  if (approvedOrigins.length === 0) {
    throw new UrlPolicyError("fixture policy requires at least one approved origin");
  }
  const normalized = new Set<string>();
  for (const value of approvedOrigins) {
    const url = parseHttpUrl(value, "approved origin");
    if (!isLoopback(url.hostname)) {
      throw new UrlPolicyError("fixture policy accepts loopback origins only; remote execution is disabled until task 20");
    }
    normalized.add(url.origin);
  }
  return { mode: "fixture_only", approvedOrigins: normalized };
}

export function assertApprovedUrl(value: string, policy: FixtureUrlPolicy): URL {
  const url = parseHttpUrl(value, "target URL");
  if (!isLoopback(url.hostname) || !policy.approvedOrigins.has(url.origin)) {
    throw new UrlPolicyError(`target origin is not approved for fixture execution: ${url.origin}`);
  }
  return url;
}

