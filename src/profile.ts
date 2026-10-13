import { createHash } from "node:crypto";
import { parseProfile, type JsonValue, type Profile } from "./contracts.js";

export interface ProfileSnapshot {
  profileId: string;
  profileSchemaVersion: number;
  profileHash: string;
  profile: Profile;
}

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
}

export function snapshotProfile(value: unknown): ProfileSnapshot {
  const profile = parseProfile(JSON.parse(JSON.stringify(value))) as Profile & JsonValue;
  const serialized = canonical(profile);
  return {
    profileId: profile.profileId,
    profileSchemaVersion: profile.schemaVersion,
    profileHash: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
    profile,
  };
}
