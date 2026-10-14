import type { Evidence, JsonValue } from "../contracts.js";

export type DemandFormat = "vast_xml" | "gam_json" | "prebid_json" | "reseller_json";
export type ParsedDemandState = "valid_ad" | "no_fill" | "no_bid" | "wrapper" | "failed" | "malformed" | "unsupported" | "truncated" | "unknown";

export interface DemandParseLimits {
  maxBodyBytes: number;
  maxXmlDepth: number;
  supportedVastVersions: string[];
}

export interface ParsedDemandResponse {
  state: ParsedDemandState;
  transport: "pass" | "fail" | "unknown";
  cause: string | null;
  wrapperUrl: string | null;
  details: { [key: string]: JsonValue };
}

function responseBody(evidence: Evidence): Record<string, JsonValue> | null {
  const body = evidence.data.responseBody;
  return typeof body === "object" && body !== null && !Array.isArray(body) ? body : null;
}

function textBody(evidence: Evidence, limits: DemandParseLimits): { text: string } | ParsedDemandResponse {
  const body = responseBody(evidence);
  if (body === null || body.state === "unavailable") return { state: "unknown", transport: "unknown", cause: "response_body_unavailable", wrapperUrl: null, details: {} };
  if (body.state === "omitted") {
    const reason = typeof body.reason === "string" ? body.reason : "response_body_omitted";
    const state = reason.includes("size_limit") ? "truncated" : "unknown";
    return { state, transport: "pass", cause: reason, wrapperUrl: null, details: {} };
  }
  if (body.state !== "captured" || typeof body.text !== "string") return { state: "unknown", transport: "unknown", cause: "response_body_unavailable", wrapperUrl: null, details: {} };
  if (Buffer.byteLength(body.text, "utf8") > limits.maxBodyBytes) return { state: "truncated", transport: "pass", cause: "body_size_limit", wrapperUrl: null, details: { observedBytes: Buffer.byteLength(body.text, "utf8") } };
  return { text: body.text };
}

function decodeXmlText(value: string): string {
  return value.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "").trim()
    .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
}

function parseVast(text: string, limits: DemandParseLimits): ParsedDemandResponse {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return { state: "unsupported", transport: "pass", cause: "external_xml_construct_rejected", wrapperUrl: null, details: {} };
  const root = /<VAST\b([^>]*)>/i.exec(text);
  if (root === null) return { state: "malformed", transport: "pass", cause: "missing_vast_root", wrapperUrl: null, details: {} };
  const version = /\bversion\s*=\s*["']([^"']+)["']/i.exec(root[1] ?? "")?.[1] ?? null;
  if (version === null || !limits.supportedVastVersions.includes(version)) return { state: "unsupported", transport: "pass", cause: "unsupported_vast_version", wrapperUrl: null, details: { version } };

  const stack: string[] = [];
  const structure = text.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  const tags = structure.matchAll(/<\s*(\/?)\s*([A-Za-z][\w:.-]*)\b([^>]*)>/g);
  for (const match of tags) {
    const closing = match[1] === "/";
    const name = match[2]!.toLowerCase();
    const selfClosing = /\/\s*$/.test(match[3] ?? "");
    if (closing) {
      if (stack.pop() !== name) return { state: "malformed", transport: "pass", cause: "mismatched_xml_tags", wrapperUrl: null, details: { version } };
    } else if (!selfClosing) {
      stack.push(name);
      if (stack.length > limits.maxXmlDepth) return { state: "unsupported", transport: "pass", cause: "xml_depth_limit", wrapperUrl: null, details: { version, observedDepth: stack.length } };
    }
  }
  if (stack.length > 0) return { state: "malformed", transport: "pass", cause: "unclosed_xml_tags", wrapperUrl: null, details: { version } };
  if (!/<Ad\b/i.test(text)) return { state: "no_fill", transport: "pass", cause: "vast_no_ad", wrapperUrl: null, details: { version } };
  if (/<InLine\b/i.test(text)) return { state: "valid_ad", transport: "pass", cause: null, wrapperUrl: null, details: { version, creative: "inline" } };
  if (/<Wrapper\b/i.test(text)) {
    const uri = /<VASTAdTagURI\b[^>]*>([\s\S]*?)<\/VASTAdTagURI>/i.exec(text)?.[1];
    if (uri === undefined) return { state: "malformed", transport: "pass", cause: "wrapper_uri_missing", wrapperUrl: null, details: { version } };
    const wrapperUrl = decodeXmlText(uri);
    try {
      const parsed = new URL(wrapperUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("unsupported protocol");
    } catch {
      return { state: "malformed", transport: "pass", cause: "wrapper_uri_invalid", wrapperUrl: null, details: { version } };
    }
    return { state: "wrapper", transport: "pass", cause: null, wrapperUrl, details: { version } };
  }
  return { state: "unsupported", transport: "pass", cause: "unsupported_vast_ad_shape", wrapperUrl: null, details: { version } };
}

function parseJson(text: string, format: Exclude<DemandFormat, "vast_xml">): ParsedDemandResponse {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { state: "malformed", transport: "pass", cause: "malformed_json", wrapperUrl: null, details: {} }; }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { state: "unsupported", transport: "pass", cause: "unsupported_json_shape", wrapperUrl: null, details: {} };
  const body = value as Record<string, unknown>;
  if (format === "gam_json") {
    if (body.matched === true || (Array.isArray(body.ads) && body.ads.length > 0)) return { state: "valid_ad", transport: "pass", cause: null, wrapperUrl: null, details: {} };
    if (body.matched === false || body.status === "no_fill") return { state: "no_fill", transport: "pass", cause: "gam_no_fill", wrapperUrl: null, details: {} };
  }
  if (format === "prebid_json" && Array.isArray(body.bids)) return body.bids.length > 0
    ? { state: "valid_ad", transport: "pass", cause: null, wrapperUrl: null, details: { bidCount: body.bids.length } }
    : { state: "no_bid", transport: "pass", cause: "prebid_no_bid", wrapperUrl: null, details: { bidCount: 0 } };
  if (format === "reseller_json") {
    if (body.ad !== undefined && body.ad !== null) return { state: "valid_ad", transport: "pass", cause: null, wrapperUrl: null, details: {} };
    if (body.noFill === true || body.status === "no_fill") return { state: "no_fill", transport: "pass", cause: "reseller_no_fill", wrapperUrl: null, details: {} };
  }
  return { state: "unsupported", transport: "pass", cause: "unsupported_json_variant", wrapperUrl: null, details: {} };
}

export function parseDemandResponse(evidence: Evidence, format: DemandFormat, limits: DemandParseLimits): ParsedDemandResponse {
  const outcome = typeof evidence.data.outcome === "string" ? evidence.data.outcome : "incomplete";
  const status = typeof evidence.data.status === "number" ? evidence.data.status : null;
  if (outcome === "transport_failure" || outcome === "http_failure") return { state: "failed", transport: "fail", cause: outcome, wrapperUrl: null, details: { status } };
  if (outcome !== "http_success") return { state: "unknown", transport: "unknown", cause: "request_incomplete", wrapperUrl: null, details: { status } };
  if (status === 204) return { state: format === "prebid_json" ? "no_bid" : "no_fill", transport: "pass", cause: "http_204", wrapperUrl: null, details: { status } };
  const body = textBody(evidence, limits);
  if (!("text" in body)) return body;
  return format === "vast_xml" ? parseVast(body.text, limits) : parseJson(body.text, format);
}
