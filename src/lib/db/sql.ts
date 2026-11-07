// SQL fragments whose spelling differs between the databases BMS has used.

import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * Case-insensitive LIKE. SQLite's LIKE already ignores ASCII case; lowering
 * both sides extends that to every letter, so "Ł" finds "ł" too.
 */
export function ilike(column: SQLWrapper, pattern: string): SQL {
  return sql`LOWER(${column}) LIKE LOWER(${pattern})`;
}

/**
 * The database's clock as milliseconds since 1970 — how every date column is
 * stored. julianday('now') carries milliseconds on every SQLite version D1 has
 * run, which `unixepoch('subsec')` does not.
 */
export const NOW_MS = "(cast((julianday('now') - 2440587.5) * 86400000 as integer))";
export const DAY_MS = 86_400_000;

/** NOW_MS as a Drizzle fragment. */
export function nowMs(): SQL {
  return sql.raw(NOW_MS);
}
