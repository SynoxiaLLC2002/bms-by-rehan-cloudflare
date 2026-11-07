// This site's D1 database: the `DB` binding in wrangler.jsonc, one database per
// site. There is no pool and no address to configure: the Worker is handed the
// database by Cloudflare on every request.
//
// Only the Cloudflare adapter is imported here, so the middleware can use this
// without pulling in Drizzle and the schema.

import { getCloudflareContext } from "@opennextjs/cloudflare";

// The part of D1's API this app calls. Declared here rather than taken from
// Cloudflare's runtime types, which replace the DOM's fetch/Response types for
// the whole project and break every client component.
export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  meta?: { changes?: number; last_row_id?: number };
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
}

function binding(): D1Database | undefined {
  return (getCloudflareContext().env as { DB?: D1Database }).DB;
}

export function d1(): D1Database {
  const db = binding();
  if (!db) throw new Error("No D1 database: add the DB binding to wrangler.jsonc.");
  return db;
}

/** True when the Worker has a database bound. It may still be empty (first run). */
export function hasDatabase(): boolean {
  try {
    return !!binding();
  } catch {
    // Outside a request (next build): no database.
    return false;
  }
}
