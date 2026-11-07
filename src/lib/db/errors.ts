// Whether an error came from the database rather than from rendering.
//
// A render bug may fall back to a smaller page; a database failure must not,
// or the outage is cached as a normal-looking page (INCIDENT-2026-10-21.md).
// Drizzle wraps driver errors ("Failed query: …") with the driver's error as
// `cause`. D1's own errors start with D1_ (D1_ERROR, D1_EXEC_ERROR…), and its
// transient failures say "Network connection lost", "storage operation
// exceeded timeout" or "Internal error".

const TRANSIENT = /D1_|Network connection lost|storage operation exceeded|Internal error|No D1 database/i;

export function isDbError(err: unknown): boolean {
  let e = err as { name?: string; message?: string; cause?: unknown } | undefined;
  for (let depth = 0; e && depth < 5; depth++, e = e.cause as typeof e) {
    if (e.name === "DrizzleQueryError") return true;
    const message = String(e.message ?? "");
    if (message.startsWith("Failed query:") || TRANSIENT.test(message)) return true;
  }
  return false;
}
