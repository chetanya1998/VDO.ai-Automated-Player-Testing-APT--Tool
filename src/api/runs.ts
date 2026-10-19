import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { assertApprovedUrl, createBrowserUrlPolicy, UrlPolicyError } from "../browser/url-policy.js";
import type { JsonValue } from "../contracts.js";
import { snapshotProfile } from "../profile.js";
import { IdempotencyConflictError, PostgresStore, QueueCapacityError } from "../store.js";
import type { ApiIdentity } from "./auth.js";
import { serveDashboard } from "./static.js";

const MAX_BODY_BYTES = 1_048_576;

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export interface RunApiOptions {
  store: PostgresStore;
  authenticate(request: IncomingMessage): ApiIdentity | null;
  dashboardRoot?: string;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const value = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(value),
    "cache-control": "no-store",
  });
  response.end(value);
}

async function requestJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "content-type must be application/json");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new ApiError(413, "request_too_large", "request body exceeds 1 MiB");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json", "request body must be valid JSON");
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_request", "request body must be an object");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "invalid_request", `${name} must be a non-empty string`);
  }
  return value;
}

function runId(pathname: string, suffix = ""): string | null {
  const match = new RegExp(`^/v1/runs/([^/]+)${suffix}$`).exec(pathname);
  if (match?.[1] === undefined) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new ApiError(400, "invalid_path", "path identifier is invalid");
  }
}

function artifactId(pathname: string): string | null {
  const match = /^\/v1\/artifacts\/([^/]+)$/.exec(pathname);
  if (match?.[1] === undefined) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    throw new ApiError(400, "invalid_path", "path identifier is invalid");
  }
}

function submissionHash(profileHash: string, targetUrl: string, deviceId: string): string {
  return `sha256:${createHash("sha256").update(JSON.stringify([profileHash, targetUrl, deviceId])).digest("hex")}`;
}

async function createRun(request: IncomingMessage, response: ServerResponse, identity: ApiIdentity, store: PostgresStore): Promise<void> {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.trim() === "" || Buffer.byteLength(key, "utf8") > 200) {
    throw new ApiError(400, "invalid_idempotency_key", "idempotency-key must contain 1 to 200 bytes");
  }
  const body = object(await requestJson(request));
  const targetUrl = text(body.targetUrl, "targetUrl");
  const deviceId = text(body.deviceId, "deviceId");
  const snapshot = snapshotProfile(body.profile);
  if (snapshot.profile.profileStatus !== "fixture_only") {
    throw new ApiError(400, "remote_execution_disabled", "the local API accepts controlled fixture profiles until task 20");
  }
  if (!snapshot.profile.site.approvedUrls.includes(targetUrl)) {
    throw new ApiError(400, "target_not_approved", "targetUrl must be listed in profile.site.approvedUrls");
  }
  const origins = [...new Set([
    ...snapshot.profile.site.approvedUrls.map((value) => new URL(value).origin),
    ...(snapshot.profile.site.approvedResourceOrigins ?? []).map((value) => new URL(value).origin),
  ])];
  assertApprovedUrl(targetUrl, createBrowserUrlPolicy(origins));
  if (!snapshot.profile.devices.some((device) => device.id === deviceId && device.state === "enabled")) {
    throw new ApiError(400, "device_not_enabled", "deviceId must identify an enabled profile device");
  }

  const result = await store.enqueueRun({
    runId: randomUUID(),
    profileId: snapshot.profileId,
    profileVersion: snapshot.profileSchemaVersion,
    profileHash: snapshot.profileHash,
    profileSnapshot: snapshot.profile as unknown as JsonValue,
    targetUrl,
    deviceId,
    teamId: identity.teamId,
    userId: identity.userId,
    idempotencyKey: key,
    submissionHash: submissionHash(snapshot.profileHash, targetUrl, deviceId),
  });
  json(response, result.created ? 201 : 200, result);
}

async function handle(request: IncomingMessage, response: ServerResponse, options: RunApiOptions): Promise<void> {
  response.setHeader("x-content-type-options", "nosniff");
  if (options.dashboardRoot !== undefined && await serveDashboard(request, response, options.dashboardRoot)) return;
  const identity = options.authenticate(request);
  if (identity === null) {
    response.setHeader("www-authenticate", "Bearer");
    json(response, 401, { error: { code: "unauthorized", message: "valid bearer authentication is required" } });
    return;
  }
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "POST" && url.pathname === "/v1/runs") {
    await createRun(request, response, identity, options.store);
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/runs") {
    json(response, 200, { runs: await options.store.listRuns(identity.teamId) });
    return;
  }
  const reportRunId = runId(url.pathname, "/report");
  if (request.method === "GET" && reportRunId !== null) {
    const report = await options.store.getReportForTeam(identity.teamId, reportRunId);
    if (report === null) throw new ApiError(404, "not_found", "run was not found");
    json(response, report.report === null ? 202 : 200, report);
    return;
  }
  const statusRunId = runId(url.pathname);
  if (request.method === "GET" && statusRunId !== null) {
    const run = await options.store.getRunSummary(identity.teamId, statusRunId);
    if (run === null) throw new ApiError(404, "not_found", "run was not found");
    json(response, 200, run);
    return;
  }
  const requestedArtifactId = artifactId(url.pathname);
  if (request.method === "GET" && requestedArtifactId !== null) {
    const artifact = await options.store.getArtifactForTeam(identity.teamId, requestedArtifactId);
    if (artifact === null) throw new ApiError(404, "not_found", "artifact was not found");
    const details = await stat(artifact.storageRef);
    if (!details.isFile()) throw new Error("artifact storage reference is not a file");
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": details.size,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "x-artifact-kind": artifact.kind,
      "x-artifact-sha256": artifact.sha256,
    });
    await pipeline(createReadStream(artifact.storageRef), response);
    return;
  }
  throw new ApiError(404, "not_found", "endpoint was not found");
}

export function createRunApiServer(options: RunApiOptions): Server {
  return createServer((request, response) => {
    void handle(request, response, options).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof QueueCapacityError) {
        response.setHeader("retry-after", "5");
        json(response, 429, { error: { code: "queue_capacity_reached", message: "validator queue capacity reached" } });
      } else if (error instanceof IdempotencyConflictError) {
        json(response, 409, { error: { code: "idempotency_conflict", message: error.message } });
      } else if (error instanceof ApiError) {
        json(response, error.status, { error: { code: error.code, message: error.message } });
      } else if (error instanceof TypeError || error instanceof UrlPolicyError) {
        json(response, 400, { error: { code: "invalid_request", message: error.message } });
      } else {
        json(response, 500, { error: { code: "internal_error", message: "request failed" } });
      }
    });
  });
}

export async function listenLocal(server: Server, port = 8787): Promise<number> {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new TypeError("port must be an integer from 0 through 65535");
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("local API did not bind a TCP port");
  return address.port;
}
