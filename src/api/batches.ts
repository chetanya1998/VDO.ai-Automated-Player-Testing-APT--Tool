import { createHash, randomUUID } from "node:crypto";
import type { JsonValue } from "../contracts.js";
import { snapshotProfile } from "../profile.js";
import type { BatchDetail, BatchItemInput, PostgresStore } from "../store.js";
import type { ApiIdentity } from "./auth.js";
import { assertDeploymentAcceptance, assertTargetAdmission, DeploymentAcceptanceError, type DeploymentAcceptance } from "../deploy/acceptance.js";

const MAX_URLS = 25;
const MAX_DEVICES = 4;
const MAX_ITEMS = 50;

export class BatchApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BatchApiError(400, "invalid_request", "request body must be an object");
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, name: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new BatchApiError(400, "invalid_request", `${name} must be a non-empty array`);
  if (value.length > limit) throw new BatchApiError(400, "batch_limit_exceeded", `${name} must contain at most ${limit} entries`);
  return value;
}

function submissionHash(profileHash: string, targetUrls: readonly unknown[], deviceIds: readonly unknown[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify([profileHash, targetUrls, deviceIds])).digest("hex")}`;
}

function safeTarget(value: unknown, index: number): string {
  return typeof value === "string" ? value : `[invalid target ${index + 1}]`;
}

function safeDevice(value: unknown, index: number): string {
  return typeof value === "string" ? value : `[invalid device ${index + 1}]`;
}

function rejection(code: string, message: string): { code: string; message: string } {
  return { code, message };
}

export function presentBatch(detail: BatchDetail): BatchDetail & {
  items: Array<BatchDetail["items"][number] & { runUrl: string | null; reportUrl: string | null }>;
} {
  return {
    ...detail,
    items: detail.items.map((item) => ({
      ...item,
      runUrl: item.runId === null ? null : `/v1/runs/${encodeURIComponent(item.runId)}`,
      reportUrl: item.runId === null ? null : `/v1/runs/${encodeURIComponent(item.runId)}/report`,
    })),
  };
}

export async function submitBatch(
  store: PostgresStore,
  identity: ApiIdentity,
  idempotencyKey: string | undefined,
  input: unknown,
  deploymentAcceptance?: DeploymentAcceptance,
  deploymentBrowserImageDigest?: string,
): Promise<{ created: boolean; detail: ReturnType<typeof presentBatch> }> {
  if (idempotencyKey === undefined || idempotencyKey.trim() === "" || Buffer.byteLength(idempotencyKey, "utf8") > 200) {
    throw new BatchApiError(400, "invalid_idempotency_key", "idempotency-key must contain 1 to 200 bytes");
  }
  const body = object(input);
  const targetUrls = list(body.targetUrls, "targetUrls", MAX_URLS);
  const deviceIds = list(body.deviceIds, "deviceIds", MAX_DEVICES);
  if (targetUrls.length * deviceIds.length > MAX_ITEMS) {
    throw new BatchApiError(400, "batch_limit_exceeded", `a batch must contain at most ${MAX_ITEMS} URL/device items`);
  }
  const snapshot = snapshotProfile(body.profile);
  const production = snapshot.profile.profileStatus === "production";
  if (production && (deploymentAcceptance === undefined || deploymentBrowserImageDigest === undefined)) {
    throw new BatchApiError(503, "remote_execution_unavailable", "remote execution has no valid deployment acceptance");
  }
  const resourceOrigins = (snapshot.profile.site.approvedResourceOrigins ?? []).map((value) => new URL(value).origin);
  if (production) {
    try {
      assertDeploymentAcceptance({
        acceptance: deploymentAcceptance!,
        browserImageDigest: deploymentBrowserImageDigest!,
        profileHash: snapshot.profileHash,
        requiredOrigins: [...snapshot.profile.site.approvedUrls.map((value) => new URL(value).origin), ...resourceOrigins],
      });
    } catch (error) {
      if (error instanceof DeploymentAcceptanceError) throw new BatchApiError(503, "remote_execution_unavailable", "remote execution deployment acceptance does not cover this profile");
      throw error;
    }
  }
  const enabledDevices = new Set(snapshot.profile.devices.filter((device) => device.state === "enabled").map((device) => device.id));
  const seenDevices = new Set<string>();
  const deviceRejections = deviceIds.map((rawDevice) => {
    if (typeof rawDevice !== "string" || !enabledDevices.has(rawDevice)) {
      return rejection("device_not_enabled", "device ID must identify an enabled profile device");
    }
    if (seenDevices.has(rawDevice)) return rejection("duplicate_device", "duplicate device IDs are not admitted twice in one batch");
    seenDevices.add(rawDevice);
    return undefined;
  });
  const seenTargets = new Set<string>();
  const items: BatchItemInput[] = [];
  for (const [targetIndex, rawTarget] of targetUrls.entries()) {
    const targetUrl = safeTarget(rawTarget, targetIndex);
    let targetRejection: { code: string; message: string } | undefined;
    if (typeof rawTarget !== "string" || rawTarget.trim() === "") {
      targetRejection = rejection("invalid_target", "target URL must be a non-empty string");
    } else if (seenTargets.has(rawTarget)) {
      targetRejection = rejection("duplicate_target", "duplicate target URLs are not admitted twice in one batch");
    } else if (!snapshot.profile.site.approvedUrls.includes(rawTarget)) {
      targetRejection = rejection("target_not_approved", "target URL must be listed in profile.site.approvedUrls");
    } else {
      seenTargets.add(rawTarget);
      try {
        await assertTargetAdmission(snapshot, rawTarget, deploymentAcceptance, deploymentBrowserImageDigest);
      } catch {
        targetRejection = rejection("target_not_allowed", "target URL is outside the admitted execution policy");
      }
    }
    for (const [deviceIndex, rawDevice] of deviceIds.entries()) {
      const deviceId = safeDevice(rawDevice, deviceIndex);
      const deviceRejection = deviceRejections[deviceIndex];
      const itemRejection = targetRejection ?? deviceRejection;
      items.push({
        itemIndex: items.length,
        targetUrl,
        deviceId,
        runId: randomUUID(),
        ...(itemRejection === undefined ? {} : { rejection: itemRejection }),
      });
    }
  }
  const result = await store.enqueueBatch({
    batchId: randomUUID(),
    profileId: snapshot.profileId,
    profileVersion: snapshot.profileSchemaVersion,
    profileHash: snapshot.profileHash,
    profileSnapshot: snapshot.profile as unknown as JsonValue,
    teamId: identity.teamId,
    userId: identity.userId,
    idempotencyKey,
    submissionHash: submissionHash(snapshot.profileHash, targetUrls, deviceIds),
    items,
  });
  const detail = await store.getBatchForTeam(identity.teamId, result.batchId);
  if (detail === null) throw new Error("persisted batch could not be read");
  return { created: result.created, detail: presentBatch(detail) };
}
