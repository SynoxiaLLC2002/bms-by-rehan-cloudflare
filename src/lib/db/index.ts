// The database connection: Drizzle over this site's D1 database (lib/db/d1.ts).
//
// Made per request, not once per process: the D1 binding belongs to the
// request's environment, and Drizzle's wrapper over it costs nothing to build.

import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import * as relations from "./relations";
import { d1 } from "./d1";

const allSchema = { ...schema, ...relations };

function connect() {
  return drizzle(d1(), { schema: allSchema });
}

type DbInstance = ReturnType<typeof connect>;

// Proxied so the connection is opened on first use rather than on import.
// Importing this module must stay free: it is pulled in by files that only
// need a type, and by routes that may never touch the database on a request.
export const db = new Proxy({} as DbInstance, {
  get(_, prop) {
    return connect()[prop as keyof DbInstance];
  },
});
