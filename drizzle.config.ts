import { defineConfig } from "drizzle-kit";

// BMS on Cloudflare: D1 (SQLite). Migrations live in drizzle-d1/ and are
// applied with `wrangler d1 migrations apply`; the MariaDB history in
// drizzle-mysql/ belongs to BMS 2.0 and is never replayed here.
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle-d1",
  dialect: "sqlite",
});
