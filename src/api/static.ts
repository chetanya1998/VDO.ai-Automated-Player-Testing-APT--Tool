import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

const FILES = {
  "/": { path: ["web", "index.html"], type: "text/html; charset=utf-8" },
  "/dashboard.js": { path: ["web", "dist", "dashboard.js"], type: "text/javascript; charset=utf-8" },
  "/styles.css": { path: ["web", "src", "styles.css"], type: "text/css; charset=utf-8" },
} as const;

export async function serveDashboard(request: IncomingMessage, response: ServerResponse, root: string): Promise<boolean> {
  if (request.method !== "GET") return false;
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const file = FILES[pathname as keyof typeof FILES];
  if (file === undefined) return false;
  const content = await readFile(join(root, ...file.path));
  response.writeHead(200, {
    "content-type": file.type,
    "content-length": content.length,
    "cache-control": "no-store",
    "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(content);
  return true;
}
