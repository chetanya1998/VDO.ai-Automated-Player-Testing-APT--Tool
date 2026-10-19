import { parseBackendLoggerPage, type BackendLoggerPage, type BackendLoggerRecord } from "./backend-normalize.js";

export interface BackendLoggerClientOptions {
  endpoint: string;
  bearerToken: string;
  from: string;
  until: string;
  deadlineAt: string;
  pageSize?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  maxPagesPerPoll?: number;
  maxRecords?: number;
}

export interface BackendLoggerResult {
  status: "complete" | "incomplete" | "unavailable";
  reason: "watermark_complete" | "deadline_exceeded" | "unauthorized" | "request_failed" | "invalid_response" | "pagination_limit" | "record_limit";
  records: BackendLoggerRecord[];
  watermark: BackendLoggerPage["watermark"] | null;
  requests: number;
  pages: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function boundedInteger(value: number, name: string, maximum: number): number {
  const parsed = positiveInteger(value, name);
  if (parsed > maximum) throw new TypeError(`${name} must not exceed ${maximum}`);
  return parsed;
}

function instant(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be an ISO timestamp`);
  return parsed;
}

function endpoint(value: string): URL {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || !["http:", "https:"].includes(parsed.protocol)) throw new TypeError("endpoint must be an HTTP(S) URL without credentials");
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !loopback) throw new TypeError("remote backend logger endpoints must use HTTPS");
  return parsed;
}

function retryAfterMs(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : fallback;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function collectBackendLogger(options: BackendLoggerClientOptions): Promise<BackendLoggerResult> {
  const base = endpoint(options.endpoint);
  if (options.bearerToken.trim() === "") throw new TypeError("bearerToken is required");
  const from = instant(options.from, "from");
  const until = instant(options.until, "until");
  const deadline = instant(options.deadlineAt, "deadlineAt");
  if (until < from) throw new TypeError("until must not precede from");
  const pageSize = boundedInteger(options.pageSize ?? 100, "pageSize", 1_000);
  const pollIntervalMs = boundedInteger(options.pollIntervalMs ?? 1_000, "pollIntervalMs", 60_000);
  const requestTimeoutMs = boundedInteger(options.requestTimeoutMs ?? 10_000, "requestTimeoutMs", 30_000);
  const maxPages = boundedInteger(options.maxPagesPerPoll ?? 100, "maxPagesPerPoll", 100);
  const maxRecords = boundedInteger(options.maxRecords ?? 10_000, "maxRecords", 100_000);
  const records = new Map<string, BackendLoggerRecord>();
  let watermark: BackendLoggerPage["watermark"] | null = null;
  let requests = 0;
  let pages = 0;

  while (Date.now() < deadline) {
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    let pollPages = 0;
    do {
      if (Date.now() >= deadline) break;
      if (pollPages >= maxPages) return { status: "unavailable", reason: "pagination_limit", records: [...records.values()], watermark, requests, pages };
      const url = new URL(base);
      url.searchParams.set("from", options.from);
      url.searchParams.set("until", options.until);
      url.searchParams.set("limit", String(pageSize));
      if (cursor !== null) url.searchParams.set("cursor", cursor);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, Math.max(1, deadline - Date.now())));
      let response: Response;
      try {
        requests += 1;
        response = await fetch(url, {
          headers: { authorization: `Bearer ${options.bearerToken}`, accept: "application/json" },
          redirect: "error",
          signal: controller.signal,
        });
      } catch {
        clearTimeout(timeout);
        if (Date.now() >= deadline) break;
        return { status: "unavailable", reason: "request_failed", records: [...records.values()], watermark, requests, pages };
      }
      if (response.status === 401 || response.status === 403) {
        clearTimeout(timeout);
        return { status: "unavailable", reason: "unauthorized", records: [...records.values()], watermark, requests, pages };
      }
      if (response.status === 429) {
        clearTimeout(timeout);
        await wait(Math.min(retryAfterMs(response.headers.get("retry-after"), pollIntervalMs), Math.max(0, deadline - Date.now())));
        continue;
      }
      if (!response.ok) {
        clearTimeout(timeout);
        return { status: "unavailable", reason: "request_failed", records: [...records.values()], watermark, requests, pages };
      }
      let page: BackendLoggerPage;
      try {
        page = parseBackendLoggerPage(await response.json());
      } catch {
        clearTimeout(timeout);
        if (Date.now() >= deadline) break;
        return { status: "unavailable", reason: "invalid_response", records: [...records.values()], watermark, requests, pages };
      }
      clearTimeout(timeout);
      pages += 1;
      pollPages += 1;
      watermark = page.watermark;
      for (const item of page.records) {
        if (!records.has(item.recordId) && records.size >= maxRecords) {
          return { status: "unavailable", reason: "record_limit", records: [...records.values()], watermark, requests, pages };
        }
        records.set(item.recordId, item);
      }
      cursor = page.nextCursor;
      if (cursor !== null) {
        if (seenCursors.has(cursor)) return { status: "unavailable", reason: "invalid_response", records: [...records.values()], watermark, requests, pages };
        seenCursors.add(cursor);
      }
    } while (cursor !== null);

    if (watermark?.completeThrough !== null && watermark !== null && Date.parse(watermark.completeThrough) >= until) {
      return { status: "complete", reason: "watermark_complete", records: [...records.values()], watermark, requests, pages };
    }
    await wait(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
  }
  return { status: "incomplete", reason: "deadline_exceeded", records: [...records.values()], watermark, requests, pages };
}
