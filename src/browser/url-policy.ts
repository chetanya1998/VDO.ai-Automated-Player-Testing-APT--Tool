export const PRODUCTION_EGRESS_BOUNDARY = {
  state: "application_allowlist_only",
  currentMode: "explicit_origin_allowlist",
  unrestrictedRemoteExecution: false,
  enforcedAt: "browser_context_request_route",
  limitations: ["websocket_and_dns_controls_require_deployment_network_policy"],
} as const;

export interface BrowserUrlPolicy {
  mode: "fixture_only" | "approved_remote";
  approvedOrigins: ReadonlySet<string>;
}

export type FixtureUrlPolicy = BrowserUrlPolicy;

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

export function createBrowserUrlPolicy(approvedOrigins: readonly string[], allowRemoteOrigins = false): BrowserUrlPolicy {
  if (approvedOrigins.length === 0) {
    throw new UrlPolicyError("browser policy requires at least one approved origin");
  }
  const normalized = new Set<string>();
  for (const value of approvedOrigins) {
    const url = parseHttpUrl(value, "approved origin");
    if (!allowRemoteOrigins && !isLoopback(url.hostname)) {
      throw new UrlPolicyError("fixture policy accepts loopback origins only; remote execution is disabled until task 20");
    }
    normalized.add(url.origin);
  }
  return { mode: allowRemoteOrigins ? "approved_remote" : "fixture_only", approvedOrigins: normalized };
}

export function createFixtureUrlPolicy(approvedOrigins: readonly string[]): FixtureUrlPolicy {
  return createBrowserUrlPolicy(approvedOrigins);
}

export function assertApprovedUrl(value: string, policy: BrowserUrlPolicy): URL {
  const url = parseHttpUrl(value, "target URL");
  if ((policy.mode === "fixture_only" && !isLoopback(url.hostname)) || !policy.approvedOrigins.has(url.origin)) {
    const scope = policy.mode === "fixture_only" ? "fixture execution" : "browser execution";
    throw new UrlPolicyError(`target origin is not approved for ${scope}: ${url.origin}`);
  }
  return url;
}

