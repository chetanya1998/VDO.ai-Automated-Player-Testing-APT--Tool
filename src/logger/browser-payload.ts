import type { JsonValue } from "../contracts.js";

export const LOGGER_BODY_FIELDS = ["event", "tagName", "domainName", "page_url", "dep"] as const;
export type LoggerBodyField = (typeof LOGGER_BODY_FIELDS)[number];

export interface EventAliasProfile {
  schemaVersion: number;
  profileId: string;
  status: "synthetic_draft" | "confirmed";
  aliases: Record<string, string>;
}

export interface LoggerPayloadDiagnostic {
  code: "malformed_body" | "missing_field" | "empty_field" | "invalid_field" | "unknown_event" | "dep_changed" | "development_dep_observed";
  severity: "warning" | "failure" | "information";
  field: LoggerBodyField | null;
  detail: string;
}

export interface ParsedBrowserLoggerPayload {
  parseState: "parsed" | "malformed";
  fields: Record<LoggerBodyField, string | null>;
  rawEvent: string | null;
  canonicalEvent: string | null;
  ignoredFieldCount: number;
  diagnostics: LoggerPayloadDiagnostic[];
}

export interface PhysicalLoadPayloadSummary {
  depValues: string[];
  tagNames: string[];
  diagnostics: LoggerPayloadDiagnostic[];
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

export function parseEventAliasProfile(value: unknown): EventAliasProfile {
  const root = object(value, "eventAliases");
  if (!Number.isInteger(root.schemaVersion) || Number(root.schemaVersion) < 1) throw new TypeError("eventAliases.schemaVersion must be a positive integer");
  nonempty(root.profileId, "eventAliases.profileId");
  if (root.status !== "synthetic_draft" && root.status !== "confirmed") throw new TypeError("eventAliases.status is unsupported");
  const aliases = object(root.aliases, "eventAliases.aliases");
  if (Object.keys(aliases).length === 0) throw new TypeError("eventAliases.aliases must not be empty");
  for (const [raw, canonical] of Object.entries(aliases)) {
    nonempty(raw, "eventAliases alias name");
    nonempty(canonical, `eventAliases.aliases.${raw}`);
  }
  return value as EventAliasProfile;
}

function decodedBody(body: string | null, contentType: string): Record<string, unknown> | null {
  if (body === null || body === "") return null;
  try {
    const parsed: unknown = contentType.toLowerCase().includes("application/json")
      ? JSON.parse(body)
      : Object.fromEntries(new URLSearchParams(body));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function extractAllowlistedLoggerFields(body: string | null, contentType: string): {
  parseState: "allowlisted" | "empty" | "malformed";
  fields: { [key: string]: JsonValue };
} {
  if (body === null || body === "") return { parseState: "empty", fields: {} };
  const parsed = decodedBody(body, contentType);
  if (parsed === null) return { parseState: "malformed", fields: {} };
  return {
    parseState: "allowlisted",
    fields: Object.fromEntries(LOGGER_BODY_FIELDS.filter((field) => parsed[field] !== undefined).map((field) => {
      const value = parsed[field];
      return [field, value === null || ["string", "number", "boolean"].includes(typeof value) ? value as JsonValue : String(value)];
    })),
  };
}

function blankFields(): Record<LoggerBodyField, string | null> {
  return { event: null, tagName: null, domainName: null, page_url: null, dep: null };
}

export function parseBrowserLoggerPayload(body: string | null, contentType: string, aliasProfile: EventAliasProfile): ParsedBrowserLoggerPayload {
  const aliases = parseEventAliasProfile(aliasProfile).aliases;
  const parsed = decodedBody(body, contentType);
  const fields = blankFields();
  const diagnostics: LoggerPayloadDiagnostic[] = [];
  if (parsed === null) {
    diagnostics.push({ code: "malformed_body", severity: "warning", field: null, detail: "Logger body is empty, malformed, or is not an object." });
    return { parseState: "malformed", fields, rawEvent: null, canonicalEvent: null, ignoredFieldCount: 0, diagnostics };
  }

  for (const field of LOGGER_BODY_FIELDS) {
    const value = parsed[field];
    if (value === undefined) {
      diagnostics.push({ code: "missing_field", severity: "warning", field, detail: `${field} is missing.` });
    } else if (typeof value !== "string") {
      diagnostics.push({ code: "invalid_field", severity: "warning", field, detail: `${field} must be a string.` });
    } else if (value.trim() === "") {
      diagnostics.push({ code: "empty_field", severity: "warning", field, detail: `${field} is empty.` });
    } else if (field === "page_url" && !isHttpUrl(value)) {
      diagnostics.push({ code: "invalid_field", severity: "warning", field, detail: "page_url must be an HTTP(S) URL without credentials." });
    } else {
      fields[field] = value;
    }
  }

  const rawEvent = fields.event;
  const canonicalEvent = rawEvent === null ? null : aliases[rawEvent] ?? null;
  if (rawEvent !== null && canonicalEvent === null) {
    diagnostics.push({ code: "unknown_event", severity: "warning", field: "event", detail: `Unknown event name: ${rawEvent}` });
  }
  return {
    parseState: "parsed",
    fields,
    rawEvent,
    canonicalEvent,
    ignoredFieldCount: Object.keys(parsed).filter((key) => !LOGGER_BODY_FIELDS.includes(key as LoggerBodyField)).length,
    diagnostics,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export function summarizePhysicalLoadPayloads(payloads: readonly ParsedBrowserLoggerPayload[]): PhysicalLoadPayloadSummary {
  const depValues = [...new Set(payloads.map((payload) => payload.fields.dep).filter((value): value is string => value !== null))].sort();
  const tagNames = [...new Set(payloads.map((payload) => payload.fields.tagName).filter((value): value is string => value !== null))].sort();
  const diagnostics: LoggerPayloadDiagnostic[] = [];
  if (depValues.length > 1) diagnostics.push({
    code: "dep_changed",
    severity: "failure",
    field: "dep",
    detail: `dep changed within one physical page load: ${depValues.join(", ")}`,
  });
  if (depValues.includes("dependencies_dev_3153")) diagnostics.push({
    code: "development_dep_observed",
    severity: "information",
    field: "dep",
    detail: "dependencies_dev_3153 was observed; its production meaning is not confirmed.",
  });
  return { depValues, tagNames, diagnostics };
}
