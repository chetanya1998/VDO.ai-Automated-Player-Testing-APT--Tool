import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

export interface ApiIdentity {
  userId: string;
  teamId: string;
}

export interface BearerIdentity extends ApiIdentity {
  token: string;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createBearerAuthenticator(identities: readonly BearerIdentity[]): (request: IncomingMessage) => ApiIdentity | null {
  const tokens = new Map<string, ApiIdentity>();
  for (const identity of identities) {
    if (identity.token.length < 16 || identity.userId.trim() === "" || identity.teamId.trim() === "") {
      throw new TypeError("API identities require a token of at least 16 characters plus userId and teamId");
    }
    const key = digest(identity.token);
    if (tokens.has(key)) throw new TypeError("API bearer tokens must be unique");
    tokens.set(key, { userId: identity.userId, teamId: identity.teamId });
  }
  if (tokens.size === 0) throw new TypeError("at least one API identity is required");

  return (request) => {
    const authorization = request.headers.authorization;
    if (authorization === undefined || !authorization.startsWith("Bearer ")) return null;
    return tokens.get(digest(authorization.slice(7))) ?? null;
  };
}
