// Copy of server/src/utils/domains.js, so the form can warn while you type; keep both in step.
export const normalizeHost = (host) => host.toLowerCase().replace(/^www\./, '');

export const normalizeDomain = (value) =>
  normalizeHost(String(value).trim().replace(/^https?:\/\//i, '').split('/')[0]);

// A URL belongs to the publisher when its host is the domain or one of its subdomains (www. is ignored).
export function onDomain(domain, value) {
  try {
    const host = normalizeHost(new URL(value).hostname);
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

export const offDomainUrls = (domain, urls) => urls.filter((value) => !onDomain(domain, value));
