// Writes that hand back the rows they wrote.
//
// SQLite has RETURNING, so these are thin now; they stay so the routes written
// against the MariaDB version keep their shape.

import { asc, inArray, type InferSelectModel } from "drizzle-orm";
import type { SQLiteColumn, SQLiteInsertValue, SQLiteTable } from "drizzle-orm/sqlite-core";
import { db } from "./index";

type IdTable = SQLiteTable & { id: SQLiteColumn };

// Drizzle's builders are generic over the concrete table; these helpers take
// any table with an `id`, so the builder is reached through one narrow cast.
type Loose = {
  insert: (t: unknown) => { values: (v: unknown) => { returning: () => Promise<unknown[]> } };
  select: () => { from: (t: unknown) => { where: (w: unknown) => { orderBy: (o: unknown) => Promise<unknown[]> } } };
};
const loose = () => db as unknown as Loose;

/** INSERT one or many rows and return them as stored (defaults included), in insertion order. */
export async function insertReturning<T extends IdTable>(
  table: T,
  values: SQLiteInsertValue<T> | SQLiteInsertValue<T>[]
): Promise<InferSelectModel<T>[]> {
  const list = Array.isArray(values) ? values : [values];
  const out: InferSelectModel<T>[] = [];
  // One INSERT per row keeps every statement under D1's 100-value limit.
  for (const row of list) out.push(...((await loose().insert(table).values(row).returning()) as InferSelectModel<T>[]));
  return out;
}

/** The rows with these ids, oldest id first. */
export async function readByIds<T extends IdTable>(table: T, ids: (number | string)[]): Promise<InferSelectModel<T>[]> {
  if (ids.length === 0) return [];
  const out: InferSelectModel<T>[] = [];
  // Chunks of 90 stay under D1's 100-value limit.
  for (let i = 0; i < ids.length; i += 90) {
    out.push(...((await loose().select().from(table).where(inArray(table.id, ids.slice(i, i + 90))).orderBy(asc(table.id))) as InferSelectModel<T>[]));
  }
  return out;
}

/** Rows changed by an UPDATE or DELETE run through Drizzle (a D1 result). */
export function affectedRows(result: unknown): number {
  return Number((result as { meta?: { changes?: unknown } })?.meta?.changes ?? 0);
}
