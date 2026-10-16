import { Pool } from "pg";
import { createBearerAuthenticator, type BearerIdentity } from "./auth.js";
import { createRunApiServer, listenLocal } from "./runs.js";
import { applyMigrations, PostgresStore } from "../store.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new TypeError(`${name} is required`);
  return value;
}

function identities(): BearerIdentity[] {
  const value: unknown = JSON.parse(required("VDO_VALIDATOR_API_IDENTITIES"));
  if (!Array.isArray(value)) throw new TypeError("VDO_VALIDATOR_API_IDENTITIES must be a JSON array");
  return value as BearerIdentity[];
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: required("DATABASE_URL") });
  await applyMigrations(pool);
  const server = createRunApiServer({
    store: new PostgresStore(pool),
    authenticate: createBearerAuthenticator(identities()),
  });
  const port = await listenLocal(server, process.env.PORT === undefined ? 8787 : Number(process.env.PORT));
  console.log(`Validator API listening on http://127.0.0.1:${port}`);

  const close = () => {
    server.close(() => void pool.end());
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

void main().catch(() => {
  console.error("Validator API failed to start");
  process.exitCode = 1;
});
