import type { ConsoleMessage, Page, Request, Response } from "playwright-core";
import type { EvidenceSource, JsonValue } from "../contracts.js";

const LOGGER_FIELDS = ["event", "tagName", "domainName", "page_url", "dep"] as const;
const SENSITIVE_KEYS = /^(?:authorization|cookie|set-cookie|password|passwd|secret|token|access_token|api_key|apikey|key|jwt|session|sessionid)$/i;
const LOGGER_RESOURCE_TYPES = new Set(["xhr", "fetch", "ping"]);
const RESPONSE_BODY_TYPES = ["application/json", "text/plain"];

export interface CaptureLimits {
  maxEvidenceRecords: number;
  maxResponseBodyBytes: number;
  maxScreenshotBytes: number;
  settleTimeoutMs: number;
}

export interface CapturedBrowserEvidence {
  evidenceId: string;
  source: Exclude<EvidenceSource, "backend_logger">;
  capturedAt: string;
  data: { [key: string]: JsonValue };
}

export interface CollectionGap {
  code:
    | "service_worker_visibility"
    | "detailed_initiator_unavailable"
    | "evidence_limit_reached"
    | "pending_capture_timeout"
    | "request_incomplete"
    | "page_capture_unavailable"
    | "screenshot_too_large";
  detail: string;
  evidenceId: string | null;
}

export interface BrowserCaptureResult {
  evidence: CapturedBrowserEvidence[];
  gaps: CollectionGap[];
  complete: boolean;
}

export interface BrowserCaptureOptions {
  startedAt: Date;
  elapsedMs(): number;
  limits?: Partial<CaptureLimits>;
}

interface PendingRequest {
  evidence: CapturedBrowserEvidence;
  startedMs: number;
  completed: boolean;
}

const DEFAULT_LIMITS: CaptureLimits = {
  maxEvidenceRecords: 2_000,
  maxResponseBodyBytes: 16 * 1_024,
  maxScreenshotBytes: 256 * 1_024,
  settleTimeoutMs: 500,
};

function redactText(value: string): string {
  return value
    .replace(/secret[\s_-]*sentinel/gi, "[REDACTED]")
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:access[_-]?token|api[_-]?key|authorization|password|secret|token|session|jwt)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/((?:access[_-]?token|api[_-]?key|authorization|cookie|password|secret|session|jwt)\s*[=:]\s*)[^&\s,;"']+/gi, "$1[REDACTED]");
}

export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEYS.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return redactText(url.href);
  } catch {
    return "[invalid-url]";
  }
}

function redactValue(value: unknown, key = ""): JsonValue {
  if (SENSITIVE_KEYS.test(key)) return "[REDACTED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? sanitizeUrl(value) : redactText(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, item]) => [name, redactValue(item, name)]));
  }
  return String(value);
}

function selectedHeaders(headers: Record<string, string>): { [key: string]: JsonValue } {
  const selected: Record<string, string> = {};
  for (const name of ["content-type", "content-length", "x-vdo-fixture"]) {
    const value = headers[name];
    if (value !== undefined) selected[name] = redactText(value);
  }
  return selected;
}

function loggerFields(body: string | null, contentType: string): { parseState: string; fields: { [key: string]: JsonValue } } {
  if (body === null || body === "") return { parseState: "empty", fields: {} };
  try {
    let parsed: unknown;
    if (contentType.includes("application/json")) {
      parsed = JSON.parse(body);
    } else {
      parsed = Object.fromEntries(new URLSearchParams(body));
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { parseState: "malformed", fields: {} };
    const record = parsed as Record<string, unknown>;
    // shortcut: task 22 adds versioned field validation; persistence is allowlisted here now.
    const fields = Object.fromEntries(
      LOGGER_FIELDS.filter((field) => record[field] !== undefined).map((field) => [field, redactValue(record[field], field)]),
    );
    return { parseState: "allowlisted", fields };
  } catch {
    return { parseState: "malformed", fields: {} };
  }
}

function requestFrameUrl(request: Request): string | null {
  try {
    return sanitizeUrl(request.frame().url());
  } catch {
    return null;
  }
}

function isLoggerRequest(request: Request): boolean {
  const path = (() => {
    try { return new URL(request.url()).pathname.toLowerCase(); } catch { return ""; }
  })();
  return (path.includes("logger") || path.endsWith("logger.php")) && LOGGER_RESOURCE_TYPES.has(request.resourceType());
}

export class BrowserCapture {
  readonly #options: BrowserCaptureOptions;
  readonly #limits: CaptureLimits;
  readonly #evidence: CapturedBrowserEvidence[] = [];
  readonly #gaps: CollectionGap[] = [];
  readonly #requests = new Map<Request, PendingRequest>();
  readonly #pending = new Set<Promise<void>>();
  #sequence = 0;
  #closed = false;
  #pageCaptured = false;

  constructor(options: BrowserCaptureOptions) {
    this.#options = options;
    this.#limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.#gap(
      "service_worker_visibility",
      "Page-level browser events may not expose traffic handled entirely inside a service worker; service workers remain enabled.",
      null,
    );
    this.#gap(
      "detailed_initiator_unavailable",
      "The public Playwright request API exposes resource type and frame URL, but not the browser's full initiator stack.",
      null,
    );
  }

  attach(page: Page): void {
    page.on("request", (request) => this.#onRequest(request, page));
    page.on("response", (response) => this.#track(this.#onResponse(response)));
    page.on("requestfailed", (request) => this.#onRequestFailed(request));
    page.on("console", (message) => this.#onConsole(message, page));
    page.on("pageerror", (error) => this.#push("browser_console", {
      kind: "page_error",
      pageUrl: sanitizeUrl(page.url()),
      message: redactText(error.message),
    }));
  }

  async capturePage(page: Page): Promise<void> {
    if (this.#pageCaptured || this.#closed) return;
    this.#pageCaptured = true;
    try {
      const [title, players] = await Promise.all([
        page.title(),
        page.evaluate(() => Array.from(document.querySelectorAll("[data-synthetic-player], [id^='v-'], iframe")).slice(0, 50).map((element) => {
          const html = element as HTMLElement;
          const bounds = html.getBoundingClientRect();
          const style = getComputedStyle(html);
          return {
            tag: html.tagName.toLowerCase(),
            id: html.id,
            playerState: html.dataset.syntheticPlayer ?? null,
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
            visible: style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0,
          };
        })),
      ]);
      const frames = page.frames().slice(0, 50).map((frame) => ({ name: redactText(frame.name()), url: sanitizeUrl(frame.url()) }));
      this.#push("browser_dom", {
        kind: "page_snapshot",
        pageUrl: sanitizeUrl(page.url()),
        title: redactText(title),
        frames: redactValue(frames),
        players: redactValue(players),
      });
    } catch (error) {
      this.#gap("page_capture_unavailable", `DOM snapshot unavailable: ${redactText(error instanceof Error ? error.message : String(error))}`, null);
    }

    try {
      const image = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false, timeout: this.#limits.settleTimeoutMs });
      if (image.byteLength > this.#limits.maxScreenshotBytes) {
        this.#gap("screenshot_too_large", `Screenshot was ${image.byteLength} bytes; limit is ${this.#limits.maxScreenshotBytes}.`, null);
      } else {
        this.#push("screenshot", {
          kind: "viewport",
          pageUrl: sanitizeUrl(page.url()),
          mimeType: "image/jpeg",
          byteLength: image.byteLength,
          contentBase64: image.toString("base64"),
        });
      }
    } catch (error) {
      this.#gap("page_capture_unavailable", `Screenshot unavailable: ${redactText(error instanceof Error ? error.message : String(error))}`, null);
    }
  }

  async finalize(): Promise<BrowserCaptureResult> {
    if (this.#pending.size > 0) {
      let timer: NodeJS.Timeout | undefined;
      const settled = await Promise.race([
        Promise.allSettled([...this.#pending]).then(() => true),
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), this.#limits.settleTimeoutMs); }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      if (!settled) this.#gap("pending_capture_timeout", "Asynchronous response capture did not settle before the capture deadline.", null);
    }
    this.#closed = true;
    for (const request of this.#requests.values()) {
      if (!request.completed) {
        request.evidence.data.outcome = "incomplete";
        request.evidence.data.durationMs = Math.max(0, this.#options.elapsedMs() - request.startedMs);
        this.#gap("request_incomplete", "Request had no response or transport failure before collection ended.", request.evidence.evidenceId);
      }
    }
    return {
      evidence: this.#evidence,
      gaps: this.#gaps,
      complete: this.#gaps.length === 0,
    };
  }

  #onRequest(request: Request, page: Page): void {
    if (this.#closed) return;
    const startedMs = this.#options.elapsedMs();
    const previous = request.redirectedFrom();
    const previousEvidenceId = previous ? this.#requests.get(previous)?.evidence.evidenceId ?? null : null;
    const evidence = this.#push("browser_network", {
      kind: "request",
      method: request.method(),
      url: sanitizeUrl(request.url()),
      resourceType: request.resourceType(),
      requestStartPageUrl: sanitizeUrl(page.url()),
      startedMs,
      headers: selectedHeaders(request.headers()),
      initiator: redactValue({
        resourceType: request.resourceType(),
        frameUrl: requestFrameUrl(request),
        redirectedFromEvidenceId: previousEvidenceId,
      }),
      outcome: "pending",
    });
    if (evidence === null) return;
    this.#requests.set(request, { evidence, startedMs, completed: false });

    if (isLoggerRequest(request)) {
      const contentType = request.headers()["content-type"] ?? "";
      const body = loggerFields(request.postData(), contentType);
      this.#push("browser_logger", {
        kind: "logger_request",
        networkEvidenceId: evidence.evidenceId,
        url: sanitizeUrl(request.url()),
        requestStartPageUrl: sanitizeUrl(page.url()),
        resourceType: request.resourceType(),
        parseState: body.parseState,
        fields: body.fields,
      });
    }
  }

  async #onResponse(response: Response): Promise<void> {
    const pending = this.#requests.get(response.request());
    if (pending === undefined || this.#closed) return;
    const status = response.status();
    pending.completed = true;
    pending.evidence.data.status = status;
    pending.evidence.data.statusText = redactText(response.statusText());
    pending.evidence.data.outcome = status >= 400 ? "http_failure" : "http_success";
    pending.evidence.data.durationMs = Math.max(0, this.#options.elapsedMs() - pending.startedMs);
    const headers = response.headers();
    pending.evidence.data.responseHeaders = selectedHeaders(headers);

    const contentType = (headers["content-type"] ?? "").toLowerCase();
    if (!RESPONSE_BODY_TYPES.some((type) => contentType.includes(type))) {
      pending.evidence.data.responseBody = { state: "omitted", reason: "unapproved_content_type" };
      return;
    }
    const declaredLength = Number(headers["content-length"] ?? 0);
    if (declaredLength > this.#limits.maxResponseBodyBytes) {
      pending.evidence.data.responseBody = { state: "omitted", reason: "declared_size_limit" };
      return;
    }
    try {
      await response.finished();
      const body = await response.body();
      if (this.#closed) return;
      if (body.byteLength > this.#limits.maxResponseBodyBytes) {
        pending.evidence.data.responseBody = { state: "omitted", reason: "actual_size_limit" };
      } else {
        const text = body.toString("utf8");
        let safeText = redactText(text);
        if (contentType.includes("application/json")) {
          try { safeText = JSON.stringify(redactValue(JSON.parse(text))); } catch { /* Keep redacted malformed text. */ }
        }
        pending.evidence.data.responseBody = { state: "captured", contentType: redactText(contentType), text: safeText };
      }
    } catch (error) {
      if (!this.#closed) pending.evidence.data.responseBody = { state: "unavailable", reason: redactText(error instanceof Error ? error.message : String(error)) };
    }
  }

  #onRequestFailed(request: Request): void {
    const pending = this.#requests.get(request);
    if (pending === undefined || this.#closed) return;
    pending.completed = true;
    pending.evidence.data.outcome = "transport_failure";
    pending.evidence.data.durationMs = Math.max(0, this.#options.elapsedMs() - pending.startedMs);
    pending.evidence.data.failure = redactText(request.failure()?.errorText ?? "request failed");
  }

  #onConsole(message: ConsoleMessage, page: Page): void {
    const location = message.location();
    this.#push("browser_console", {
      kind: "console",
      level: message.type(),
      message: redactText(message.text()),
      pageUrl: sanitizeUrl(page.url()),
      location: redactValue({ url: sanitizeUrl(location.url), lineNumber: location.lineNumber, columnNumber: location.columnNumber }),
    });
  }

  #track(promise: Promise<void>): void {
    this.#pending.add(promise);
    void promise.then(
      () => this.#pending.delete(promise),
      () => this.#pending.delete(promise),
    );
  }

  #push(source: CapturedBrowserEvidence["source"], data: { [key: string]: JsonValue }): CapturedBrowserEvidence | null {
    if (this.#evidence.length >= this.#limits.maxEvidenceRecords) {
      this.#gap("evidence_limit_reached", `Evidence record limit ${this.#limits.maxEvidenceRecords} was reached.`, null);
      return null;
    }
    const atMs = this.#options.elapsedMs();
    const evidence: CapturedBrowserEvidence = {
      evidenceId: `browser-${String(++this.#sequence).padStart(6, "0")}`,
      source,
      capturedAt: new Date(this.#options.startedAt.getTime() + atMs).toISOString(),
      data,
    };
    this.#evidence.push(evidence);
    return evidence;
  }

  #gap(code: CollectionGap["code"], detail: string, evidenceId: string | null): void {
    if (this.#gaps.some((gap) => gap.code === code && gap.evidenceId === evidenceId && gap.detail === detail)) return;
    this.#gaps.push({ code, detail, evidenceId });
  }
}

