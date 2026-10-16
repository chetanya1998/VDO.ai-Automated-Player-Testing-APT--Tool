import { Pool } from "pg";
import { applyMigrations } from "../store.js";

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.trim() === "") throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, max: 1 });
try {
  await applyMigrations(pool);
  console.log("PostgreSQL migrations applied.");
} finally {
  await pool.end();
}
