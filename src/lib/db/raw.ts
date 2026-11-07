// Raw SQL against this site's D1 database, for code that must not import
// Drizzle and the schema — the middleware's cached lookups above all
// (redirects, languages, cache settings), which run in front of every request.

import { d1 } from "./d1";

type Row = Record<string, unknown>;

/** D1 refuses more than 100 bound values in one statement. */
export const MAX_PARAMS = 100;

function prepare(text: string, params: unknown[]) {
  if (/\$\d/.test(text)) throw new Error(`rawQuery: Postgres placeholder left in: ${text.slice(0, 80)}`);
  if (params.length > MAX_PARAMS) throw new Error(`rawQuery: ${params.length} values bound, D1 allows ${MAX_PARAMS}`);
  // D1 binds null, numbers, strings and ArrayBuffers only.
  const bound = params.map((p) => (p === undefined ? null : p instanceof Date ? p.getTime() : typeof p === "boolean" ? (p ? 1 : 0) : p));
  return d1().prepare(text).bind(...bound);
}

/**
 * Runs `text` with `?` bound to `params`, in order, and returns the rows.
 *
 * Throws on failure — the callers decide what a failure means for them.
 * Dates are bound as milliseconds since 1970, which is how every date column
 * is stored (schema.ts); booleans as 1 / 0.
 */
export async function rawQuery<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const { results } = await prepare(text, params).all<T>();
  return results ?? [];
}

/** Runs a write and returns how many rows it changed. */
export async function rawExec(text: string, params: unknown[] = []): Promise<number> {
  const { meta } = await prepare(text, params).run();
  return Number(meta?.changes ?? 0);
}
