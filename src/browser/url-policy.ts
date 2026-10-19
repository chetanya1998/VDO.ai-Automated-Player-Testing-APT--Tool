import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const PRODUCTION_EGRESS_BOUNDARY = {
  state: "application_allowlist_with_dns_pinning",
  currentMode: "explicit_origin_allowlist",
  unrestrictedRemoteExecution: false,
  enforcedAt: "browser_context_http_and_websocket_routes",
  limitations: ["deployment_network_policy_must_enforce_the_same_private_network_blocks"],
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

function parseNetworkUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UrlPolicyError(`${label} must be a valid URL`);
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol) || url.username || url.password) {
    throw new UrlPolicyError(`${label} must be an HTTP(S) or WebSocket URL without credentials`);
  }
  return url;
}

function approvalOrigin(url: URL): string {
  if (url.protocol === "ws:") return `http://${url.host}`;
  if (url.protocol === "wss:") return `https://${url.host}`;
  return url.origin;
}

function bareHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isLoopback(hostname: string): boolean {
  const value = bareHostname(hostname).toLowerCase();
  return value === "localhost" || value === "::1" || value.startsWith("127.");
}

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  return address.split(".").map(Number);
}

function ipv6Bytes(address: string): number[] | null {
  const clean = address.toLowerCase().split("%")[0] ?? address;
  if (isIP(clean) !== 6) return null;
  const halves = clean.split("::");
  if (halves.length > 2) return null;
  const expand = (part: string): number[] => {
    if (part === "") return [];
    const words: number[] = [];
    for (const token of part.split(":")) {
      const mapped = ipv4Bytes(token);
      if (mapped !== null) words.push((mapped[0]! << 8) | mapped[1]!, (mapped[2]! << 8) | mapped[3]!);
      else words.push(Number.parseInt(token, 16));
    }
    return words;
  };
  const left = expand(halves[0] ?? "");
  const right = expand(halves[1] ?? "");
  const zeros = halves.length === 2 ? 8 - left.length - right.length : 0;
  const words = [...left, ...Array.from({ length: zeros }, () => 0), ...right];
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return null;
  return words.flatMap((word) => [word >> 8, word & 0xff]);
}

function inPrefix(bytes: readonly number[], prefix: readonly number[], bits: number): boolean {
  const whole = Math.floor(bits / 8);
  const remaining = bits % 8;
  for (let index = 0; index < whole; index += 1) if (bytes[index] !== prefix[index]) return false;
  if (remaining === 0) return true;
  const mask = 0xff << (8 - remaining);
  return ((bytes[whole] ?? 0) & mask) === ((prefix[whole] ?? 0) & mask);
}

export function isPublicNetworkAddress(address: string): boolean {
  const v4 = ipv4Bytes(address);
  if (v4 !== null) {
    const blocked: Array<[number[], number]> = [
      [[0, 0, 0, 0], 8], [[10, 0, 0, 0], 8], [[100, 64, 0, 0], 10], [[127, 0, 0, 0], 8],
      [[169, 254, 0, 0], 16], [[172, 16, 0, 0], 12], [[192, 0, 0, 0], 24], [[192, 0, 2, 0], 24],
      [[192, 168, 0, 0], 16], [[198, 18, 0, 0], 15], [[198, 51, 100, 0], 24], [[203, 0, 113, 0], 24],
      [[224, 0, 0, 0], 4], [[240, 0, 0, 0], 4],
    ];
    return !blocked.some(([prefix, bits]) => inPrefix(v4, prefix, bits));
  }
  const v6 = ipv6Bytes(address);
  if (v6 === null) return false;
  const mapped = v6.slice(0, 12).every((byte, index) => byte === (index === 10 || index === 11 ? 0xff : 0));
  if (mapped) return isPublicNetworkAddress(v6.slice(12).join("."));
  const blocked: Array<[number[], number]> = [
    [Array(16).fill(0) as number[], 128], [[...Array(15).fill(0), 1] as number[], 128],
    [[0xfc, ...Array(15).fill(0)] as number[], 7], [[0xfe, 0x80, ...Array(14).fill(0)] as number[], 10],
    [[0xff, ...Array(15).fill(0)] as number[], 8], [[0x20, 0x01, 0x0d, 0xb8, ...Array(12).fill(0)] as number[], 32],
  ];
  return !blocked.some(([prefix, bits]) => inPrefix(v6, prefix, bits));
}

async function resolveHost(hostname: string): Promise<readonly string[]> {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((item) => item.address);
}

export class ResolvedAddressGuard {
  private readonly pinnedAddresses = new Map<string, string>();

  assertPublic(hostname: string, resolvedAddresses: readonly string[]): void {
    const addresses = [...new Set(resolvedAddresses)].sort();
    if (addresses.length === 0) throw new UrlPolicyError(`target hostname did not resolve: ${hostname}`);
    if (addresses.some((address) => !isPublicNetworkAddress(address))) {
      throw new UrlPolicyError(`target hostname resolves to a non-public address: ${hostname}`);
    }
    const fingerprint = addresses.join(",");
    const pinned = this.pinnedAddresses.get(hostname);
    if (pinned !== undefined && pinned !== fingerprint) throw new UrlPolicyError(`target hostname changed addresses during the run: ${hostname}`);
    this.pinnedAddresses.set(hostname, fingerprint);
  }
}

export class NetworkUrlGuard {
  private readonly addresses = new ResolvedAddressGuard();

  constructor(private readonly policy: BrowserUrlPolicy) {}

  async assertAllowed(value: string): Promise<URL> {
    const url = assertApprovedUrl(value, this.policy);
    if (this.policy.mode === "fixture_only") return url;
    const hostname = bareHostname(url.hostname).toLowerCase();
    this.addresses.assertPublic(hostname, await resolveHost(hostname));
    return url;
  }
}

export function createBrowserUrlPolicy(approvedOrigins: readonly string[], allowRemoteOrigins = false): BrowserUrlPolicy {
  if (approvedOrigins.length === 0) throw new UrlPolicyError("browser policy requires at least one approved origin");
  const normalized = new Set<string>();
  for (const value of approvedOrigins) {
    const url = parseNetworkUrl(value, "approved origin");
    if (url.protocol === "ws:" || url.protocol === "wss:") throw new UrlPolicyError("approved origins must use HTTP(S)");
    if (!allowRemoteOrigins && !isLoopback(url.hostname)) {
      throw new UrlPolicyError("fixture policy accepts loopback origins only; remote execution requires task 20 deployment controls");
    }
    normalized.add(url.origin);
  }
  return { mode: allowRemoteOrigins ? "approved_remote" : "fixture_only", approvedOrigins: normalized };
}

export function createFixtureUrlPolicy(approvedOrigins: readonly string[]): FixtureUrlPolicy {
  return createBrowserUrlPolicy(approvedOrigins);
}

export function assertApprovedUrl(value: string, policy: BrowserUrlPolicy): URL {
  const url = parseNetworkUrl(value, "target URL");
  const origin = approvalOrigin(url);
  if ((policy.mode === "fixture_only" && !isLoopback(url.hostname)) || !policy.approvedOrigins.has(origin)) {
    const scope = policy.mode === "fixture_only" ? "fixture execution" : "browser execution";
    throw new UrlPolicyError(`target origin is not approved for ${scope}: ${origin}`);
  }
  return url;
}
