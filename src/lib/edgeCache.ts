// Public-page HTML cache for the Cloudflare edition.
//
// Cloudflare never caches a response a Worker builds itself, so the
// `s-maxage` on public pages did nothing: every visit re-rendered the page
// (Worker → BMS → D1), 1–3 s before the first byte. The public Worker now
// keeps rendered pages (Cache API + R2, see astro/src/middleware.ts), tagged with
// a site version stored in site_settings. Every public change already passes through
// revalidatePublicSite() or refreshPublic(); both call bumpEdgeCache(), so the
// next request after a save misses and re-renders. No zone purge, no API token.
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { rawQuery } from "@/lib/db/raw";

export const EDGE_VERSION_KEY = "edge_cache_version";

/** Makes every cached public page stale (the write runs behind the response). */
export function bumpEdgeCache(): void {
  const job = rawQuery(
    "INSERT INTO site_settings (`key`, value) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value",
    [EDGE_VERSION_KEY, String(Date.now())]
  ).catch(() => undefined);
  try {
    (getCloudflareContext().ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined)?.waitUntil?.(job);
  } catch {
    // Outside a request: the promise simply runs.
  }
}

// Held for a few seconds per isolate so a busy page doesn't read D1 on every
// request; a save shows on the public site within VERSION_TTL_MS.
const VERSION_TTL_MS = 3_000;
let held: { value: string; at: number } | null = null;

/** The current site version: part of every cache key. */
export async function edgeCacheVersion(): Promise<string> {
  if (held && Date.now() - held.at < VERSION_TTL_MS) return held.value;
  const rows = await rawQuery<{ value: string }>("SELECT value FROM site_settings WHERE `key` = ?", [EDGE_VERSION_KEY]);
  held = { value: rows[0]?.value ?? "0", at: Date.now() };
  return held.value;
}
