const SHARED_ID_KEYS = ["pageviewId", "playerId", "auctionId", "requestId"] as const;

export interface BackendLoggerRecord {
  recordId: string;
  receivedAt: string;
  fields: {
    event: string | null;
    tagName: string | null;
    domainName: string | null;
    page_url: string | null;
    dep: string | null;
  };
  identifiers: Partial<Record<(typeof SHARED_ID_KEYS)[number], string>>;
}

export interface BackendLoggerPage {
  records: BackendLoggerRecord[];
  nextCursor: string | null;
  watermark: {
    observedAt: string;
    completeThrough: string | null;
    lagMs: number | null;
  };
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : string(value, path);
}

function instant(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!Number.isFinite(Date.parse(parsed))) throw new TypeError(`${path} must be an ISO timestamp`);
  return parsed;
}

function record(value: unknown, index: number): BackendLoggerRecord {
  const item = object(value, `records[${index}]`);
  const fields = object(item.fields, `records[${index}].fields`);
  const sourceIdentifiers = item.identifiers === undefined ? {} : object(item.identifiers, `records[${index}].identifiers`);
  const identifiers: BackendLoggerRecord["identifiers"] = {};
  for (const key of SHARED_ID_KEYS) {
    if (sourceIdentifiers[key] !== undefined && sourceIdentifiers[key] !== null) identifiers[key] = string(sourceIdentifiers[key], `records[${index}].identifiers.${key}`);
  }
  return {
    recordId: string(item.recordId, `records[${index}].recordId`),
    receivedAt: instant(item.receivedAt, `records[${index}].receivedAt`),
    fields: {
      event: nullableString(fields.event, `records[${index}].fields.event`),
      tagName: nullableString(fields.tagName, `records[${index}].fields.tagName`),
      domainName: nullableString(fields.domainName, `records[${index}].fields.domainName`),
      page_url: nullableString(fields.page_url, `records[${index}].fields.page_url`),
      dep: nullableString(fields.dep, `records[${index}].fields.dep`),
    },
    identifiers,
  };
}

export function parseBackendLoggerPage(value: unknown): BackendLoggerPage {
  const page = object(value, "backend logger response");
  if (page.schemaVersion !== 1) throw new TypeError("backend logger response.schemaVersion must be 1");
  if (!Array.isArray(page.records)) throw new TypeError("backend logger response.records must be an array");
  const watermark = object(page.watermark, "backend logger response.watermark");
  const lagMs = watermark.lagMs;
  if (lagMs !== null && (typeof lagMs !== "number" || !Number.isFinite(lagMs) || lagMs < 0)) {
    throw new TypeError("backend logger response.watermark.lagMs must be null or a non-negative number");
  }
  return {
    records: page.records.map(record),
    nextCursor: nullableString(page.nextCursor, "backend logger response.nextCursor"),
    watermark: {
      observedAt: instant(watermark.observedAt, "backend logger response.watermark.observedAt"),
      completeThrough: watermark.completeThrough === null ? null : instant(watermark.completeThrough, "backend logger response.watermark.completeThrough"),
      lagMs: lagMs as number | null,
    },
  };
}
