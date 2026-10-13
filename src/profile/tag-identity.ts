export const PRODUCTS = ["video", "carousel", "story", "banner"] as const;
export type Product = (typeof PRODUCTS)[number];
export type IdentityVerdict = "PASS" | "FAIL" | "UNKNOWN";

export interface SiteTagProfile {
  baseTag: string;
  allowedTagNames: string[];
  product: Product;
  placement: "inline_body_content" | "floating" | "unconfirmed";
  floatingMode: "inline" | "floating" | "unconfirmed";
  ruleSupport: "supported" | "unsupported";
}

export interface SiteIdentityProfile {
  mappingId: string;
  approvedHosts: string[];
  rootDomain: string;
  acceptedDomainNames: string[];
  allowMultipleTags: boolean;
  tags: SiteTagProfile[];
}

export interface SiteProfileCatalog {
  schemaVersion: number;
  status: "synthetic_draft" | "confirmed";
  productPrefixes: Record<"v" | "c" | "s" | "b", Product>;
  sites: SiteIdentityProfile[];
}

export interface TagIdentityInput {
  siteUrl: string;
  observedTagName: string | null;
  observedDomainName: string | null;
  activeProduct?: Product;
}

export interface TagIdentityResult {
  verdict: IdentityVerdict;
  reason: "approved_match" | "site_mapping_missing" | "tag_missing" | "domain_missing" | "tag_mismatch" | "domain_mismatch" | "product_mismatch";
  mappingId: string | null;
  expectedRootDomain: string | null;
  candidateTags: string[];
  matchedTag: SiteTagProfile | null;
  ruleSupport: "supported" | "unsupported" | "unknown";
  detail: string;
}

export interface TagSetResult {
  verdict: IdentityVerdict;
  mappingId: string | null;
  identities: TagIdentityResult[];
  detail: string;
}

const PREFIX_PRODUCTS: SiteProfileCatalog["productPrefixes"] = {
  v: "video",
  c: "carousel",
  s: "story",
  b: "banner",
};
const MULTIPART_SUFFIXES = ["co.in"];

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${path} must be a non-empty array`);
  return value.map((item, index) => nonempty(item, `${path}[${index}]`));
}

function hostname(value: string, path: string): string {
  const normalized = value.toLowerCase().replace(/\.$/, "");
  let parsed: URL;
  try { parsed = new URL(`https://${normalized}`); } catch { throw new TypeError(`${path} must be a hostname`); }
  if (parsed.hostname !== normalized || parsed.username || parsed.password || parsed.port) throw new TypeError(`${path} must be a hostname`);
  return normalized;
}

function product(value: unknown, path: string): Product {
  if (typeof value !== "string" || !PRODUCTS.includes(value as Product)) throw new TypeError(`${path} must be a supported product`);
  return value as Product;
}

export function parseSiteProfileCatalog(value: unknown): SiteProfileCatalog {
  const root = record(value, "siteProfiles");
  if (!Number.isInteger(root.schemaVersion) || Number(root.schemaVersion) < 1) throw new TypeError("siteProfiles.schemaVersion must be a positive integer");
  if (root.status !== "synthetic_draft" && root.status !== "confirmed") throw new TypeError("siteProfiles.status is unsupported");
  const prefixes = record(root.productPrefixes, "siteProfiles.productPrefixes");
  for (const [prefix, expected] of Object.entries(PREFIX_PRODUCTS)) {
    if (prefixes[prefix] !== expected) throw new TypeError(`siteProfiles.productPrefixes.${prefix} must be ${expected}`);
  }
  if (!Array.isArray(root.sites) || root.sites.length === 0) throw new TypeError("siteProfiles.sites must be a non-empty array");
  const mappingIds = new Set<string>();
  const approvedHosts = new Set<string>();
  for (const [siteIndex, rawSite] of root.sites.entries()) {
    const site = record(rawSite, `siteProfiles.sites[${siteIndex}]`);
    const mappingId = nonempty(site.mappingId, `siteProfiles.sites[${siteIndex}].mappingId`);
    if (mappingIds.has(mappingId)) throw new TypeError(`duplicate mappingId: ${mappingId}`);
    mappingIds.add(mappingId);
    for (const host of strings(site.approvedHosts, `siteProfiles.sites[${siteIndex}].approvedHosts`)) {
      const normalized = hostname(host, `siteProfiles.sites[${siteIndex}].approvedHosts`);
      if (approvedHosts.has(normalized)) throw new TypeError(`approved host has multiple mappings: ${normalized}`);
      approvedHosts.add(normalized);
    }
    hostname(nonempty(site.rootDomain, `siteProfiles.sites[${siteIndex}].rootDomain`), `siteProfiles.sites[${siteIndex}].rootDomain`);
    strings(site.acceptedDomainNames, `siteProfiles.sites[${siteIndex}].acceptedDomainNames`).forEach((item) => hostname(item, "acceptedDomainNames"));
    if (typeof site.allowMultipleTags !== "boolean") throw new TypeError(`siteProfiles.sites[${siteIndex}].allowMultipleTags must be boolean`);
    if (!Array.isArray(site.tags) || site.tags.length === 0) throw new TypeError(`siteProfiles.sites[${siteIndex}].tags must be a non-empty array`);
    const tagNames = new Set<string>();
    for (const [tagIndex, rawTag] of site.tags.entries()) {
      const tag = record(rawTag, `siteProfiles.sites[${siteIndex}].tags[${tagIndex}]`);
      const baseTag = nonempty(tag.baseTag, "tag.baseTag");
      const tagProduct = product(tag.product, "tag.product");
      const prefix = baseTag.split("-", 1)[0] as keyof typeof PREFIX_PRODUCTS;
      if (PREFIX_PRODUCTS[prefix] !== tagProduct) throw new TypeError(`${baseTag} prefix does not match ${tagProduct}`);
      const allowed = strings(tag.allowedTagNames, "tag.allowedTagNames");
      if (!allowed.includes(baseTag) || allowed.some((name) => ![baseTag, `${baseTag}-v1`, `${baseTag}-v2`].includes(name))) {
        throw new TypeError(`${baseTag} variants must be the base tag and optional -v1/-v2 names`);
      }
      for (const name of allowed) {
        if (tagNames.has(name)) throw new TypeError(`duplicate allowed tag: ${name}`);
        tagNames.add(name);
      }
      if (!["inline_body_content", "floating", "unconfirmed"].includes(String(tag.placement))) throw new TypeError(`${baseTag} placement is unsupported`);
      if (!["inline", "floating", "unconfirmed"].includes(String(tag.floatingMode))) throw new TypeError(`${baseTag} floatingMode is unsupported`);
      if (tag.ruleSupport !== "supported" && tag.ruleSupport !== "unsupported") throw new TypeError(`${baseTag} ruleSupport is unsupported`);
      if (tagProduct !== "video" && tag.ruleSupport === "supported") throw new TypeError(`${baseTag} cannot inherit supported video rules`);
    }
  }
  return value as SiteProfileCatalog;
}

function rootDomainCandidate(host: string): string {
  const labels = host.split(".").filter(Boolean);
  const multipart = MULTIPART_SUFFIXES.find((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  const suffixLabels = multipart?.split(".").length ?? 1;
  const count = Math.min(labels.length, suffixLabels + 1);
  return labels.slice(-count).join(".");
}

export function proposeTagCandidates(siteUrl: string): string[] {
  let host: string;
  try {
    const parsed = new URL(siteUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("unsupported URL");
    host = parsed.hostname.toLowerCase();
  } catch {
    throw new TypeError("siteUrl must be an HTTP(S) URL without credentials");
  }
  const stem = rootDomainCandidate(host).replaceAll(".", "-");
  return (Object.keys(PREFIX_PRODUCTS) as Array<keyof typeof PREFIX_PRODUCTS>).map((prefix) => `${prefix}-${stem}`);
}

function mappingFor(siteUrl: string, catalog: SiteProfileCatalog): SiteIdentityProfile | null {
  const parsed = new URL(siteUrl);
  const host = parsed.hostname.toLowerCase();
  return catalog.sites.find((site) => site.approvedHosts.some((approved) => approved.toLowerCase() === host)) ?? null;
}

export function resolveTagIdentity(input: TagIdentityInput, rawCatalog: SiteProfileCatalog): TagIdentityResult {
  const catalog = parseSiteProfileCatalog(rawCatalog);
  const candidateTags = proposeTagCandidates(input.siteUrl);
  const mapping = mappingFor(input.siteUrl, catalog);
  if (mapping === null) return {
    verdict: "UNKNOWN",
    reason: "site_mapping_missing",
    mappingId: null,
    expectedRootDomain: null,
    candidateTags,
    matchedTag: null,
    ruleSupport: "unknown",
    detail: "No approved site mapping exists; candidates do not prove ownership.",
  };
  if (input.observedDomainName === null || input.observedDomainName.trim() === "") return unresolved(mapping, candidateTags, "domain_missing", "Logger domainName is unavailable.");
  const domain = input.observedDomainName.toLowerCase().replace(/\.$/, "");
  if (!mapping.acceptedDomainNames.some((expected) => expected.toLowerCase() === domain)) return failed(mapping, candidateTags, "domain_mismatch", `Observed domain ${input.observedDomainName} is not approved.`);
  if (input.observedTagName === null || input.observedTagName.trim() === "") return unresolved(mapping, candidateTags, "tag_missing", "Logger tagName is unavailable.");
  const matchedTag = mapping.tags.find((tag) => tag.allowedTagNames.includes(input.observedTagName!)) ?? null;
  if (matchedTag === null) return failed(mapping, candidateTags, "tag_mismatch", `Observed tag ${input.observedTagName} is not approved.`);
  if (input.activeProduct !== undefined && matchedTag.product !== input.activeProduct) return {
    ...failed(mapping, candidateTags, "product_mismatch", `Observed tag is ${matchedTag.product}; active profile requires ${input.activeProduct}.`),
    matchedTag,
    ruleSupport: matchedTag.ruleSupport,
  };
  return {
    verdict: "PASS",
    reason: "approved_match",
    mappingId: mapping.mappingId,
    expectedRootDomain: mapping.rootDomain,
    candidateTags,
    matchedTag,
    ruleSupport: matchedTag.ruleSupport,
    detail: matchedTag.ruleSupport === "supported"
      ? "Observed domain, tag, and product match an approved mapping."
      : "Identity matches, but product-specific validation rules are not supported by this profile.",
  };
}

function unresolved(mapping: SiteIdentityProfile, candidateTags: string[], reason: "tag_missing" | "domain_missing", detail: string): TagIdentityResult {
  return { verdict: "UNKNOWN", reason, mappingId: mapping.mappingId, expectedRootDomain: mapping.rootDomain, candidateTags, matchedTag: null, ruleSupport: "unknown", detail };
}

function failed(mapping: SiteIdentityProfile, candidateTags: string[], reason: "tag_mismatch" | "domain_mismatch" | "product_mismatch", detail: string): TagIdentityResult {
  return { verdict: "FAIL", reason, mappingId: mapping.mappingId, expectedRootDomain: mapping.rootDomain, candidateTags, matchedTag: null, ruleSupport: "unknown", detail };
}

export function validateTagSet(input: {
  siteUrl: string;
  observations: Array<{ tagName: string | null; domainName: string | null }>;
  activeProduct?: Product;
}, rawCatalog: SiteProfileCatalog): TagSetResult {
  const catalog = parseSiteProfileCatalog(rawCatalog);
  const mapping = mappingFor(input.siteUrl, catalog);
  const identities = input.observations.map((observation) => resolveTagIdentity({
    siteUrl: input.siteUrl,
    observedTagName: observation.tagName,
    observedDomainName: observation.domainName,
    ...(input.activeProduct === undefined ? {} : { activeProduct: input.activeProduct }),
  }, catalog));
  if (mapping !== null && !mapping.allowMultipleTags && identities.length > 1) return {
    verdict: "FAIL",
    mappingId: mapping.mappingId,
    identities,
    detail: "The approved site mapping does not allow multiple tags.",
  };
  const verdict: IdentityVerdict = identities.some((identity) => identity.verdict === "FAIL")
    ? "FAIL"
    : identities.length === 0 || identities.some((identity) => identity.verdict === "UNKNOWN") ? "UNKNOWN" : "PASS";
  return {
    verdict,
    mappingId: mapping?.mappingId ?? null,
    identities,
    detail: identities.length === 0 ? "No tag observations were supplied." : "Each observation retains its own approved identity result.",
  };
}
